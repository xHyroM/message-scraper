import hyttpo from 'hyttpo';
import { AsyncQueue } from '@sapphire/async-queue';
import { getIdentifiers } from '../utils/getIdentifiers';
import { Saver } from './Saver';

export enum FileType {
    'Txt' = 1,
    'Markdown' = 2,
    'Html' = 3,
}

export class Scraper {
    token: string;
    fileType: FileType;
    channelId: string;
    asyncQueue: AsyncQueue;

    constructor(token: string, channelId: string, fileType: FileType) {
        this.token = token;
        this.fileType = fileType;
        this.channelId = channelId;

        this.asyncQueue = new AsyncQueue();

        this.setup();
    }

    private async setup() {
        await this.checkToken();
        await this.checkChannel();
        await this.scrapeMessages();
    }

    private async checkToken() {
        const valid = await hyttpo.get('https://discord.com/api/v9/users/@me/guilds', {
            headers: {
                ...getIdentifiers(),
                'Authorization': this.token
            }
        }).catch(e => e);

        if (!valid.ok) return console.log('Error: Invalid token!');
    }

    private async checkChannel() {
        const valid = await hyttpo.get(`https://discord.com/api/v9/channels/${this.channelId}`, {
            headers: {
                ...getIdentifiers(),
                'Authorization': this.token
            }
        }).catch(e => e);

        if (!valid.ok) return console.log('Error: Invalid channel!');
    }

    private async searchInChannel() {
        const { data } = await hyttpo.get(`https://discord.com/api/v9/channels/${this.channelId}/messages/search?sort_by=timestamp&sort_order=asc&offset=0`, {
            headers: {
                ...getIdentifiers(),
                'Authorization': this.token
            }
        }).catch(e => e);

        return{ total: data.total_results, firstMessage: data.messages[0]?.[0] };
    }

    private async scrapeMessages() {
        const saver = new Saver(this.channelId, this.fileType);
        const { total, firstMessage } = await this.searchInChannel();
        let afterMsg = firstMessage.id;
        let scraped = 1;

        (async() => {
            await this.asyncQueue.wait();
            try {
                await saver.addMessage(firstMessage);
            } finally {
                await this.asyncQueue.shift();
            }
        })();

        while(true) {
            const messages = await hyttpo.get(`https://discord.com/api/v9/channels/${this.channelId}/messages?limit=100${afterMsg.length > 0 ? `&after=${afterMsg}` : ""}`, {
                headers: {
                    ...getIdentifiers(),
                    'Authorization': this.token
                }
            }).catch(e => e);
    
            let msgs: Array<any> = messages.data;
            if (msgs.length === 0) continue;

            afterMsg = msgs[0].id;
            scraped += msgs.length;

            console.log(`Info: Scraped ${msgs.length} messages (${Math.floor((scraped * 100) / total)}%). Remaining: ${total - scraped}`);

            for (const m of msgs.reverse()) {
                await this.asyncQueue.wait();
                try {
                    await saver.addMessage(m);
                } finally {
                    await this.asyncQueue.shift()
                }
            }

            if (msgs.length < 100) {
                console.log(`Info: Tottaly scraped ${scraped} messages.`);
                break;
            }
        }
    }
}