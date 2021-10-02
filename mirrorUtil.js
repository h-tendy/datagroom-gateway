// @ts-check
const MongoClient = require('mongodb').MongoClient;

class MongoDbClientWrapper {
    constructor (url) {
        this.url = url;
        this.client = null;
    }
    async connect () {
        this.client = await MongoClient.connect(this.url, { useNewUrlParser: true, useUnifiedTopology: true })
            .catch(err => { console.log(err); this.client = null; });
    }
    async deleteDb (dbName) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        return await db.dropDatabase();
    }
    async listDatabases () {
        if (! this.client ) await this.connect();
        let dbs = await this.client.db().admin().listDatabases();
        return dbs.databases;
    }
    async getClient() {
        if (! this.client ) await this.connect();
        return this.client
    }
}

async function deleteAll(url) {
    let dgVd = new MongoDbClientWrapper(url);
    let dgVdClient = await dgVd.getClient();

    let dbList = await dgVd.listDatabases();
    let sysDbs = ['admin', 'config', 'local'];
    for (let i = 0; i < dbList.length; i++) {
        let j = sysDbs.indexOf(dbList[i].name);
        if (j > -1)
            continue;
        await dgVd.deleteDb(dbList[i].name);
    }
    console.log(`Done delete all`);
}

async function doIt(fromUrl, toUrl) {
    let from = new MongoDbClientWrapper(fromUrl);
    let fromClient = await from.getClient();
    let to = new MongoDbClientWrapper(toUrl);
    let toClient = await to.getClient();

    let dbList = await from.listDatabases();
    //console.log("List: ", dbList);
    let sysDbs = ['admin', 'config', 'local'];
    let collections = ['data', 'metaData', 'editlog', 'attachments'];
    for (let i = 0; i < dbList.length; i++) {
        let j = sysDbs.indexOf(dbList[i].name);
        if (j > -1)
            continue;
        for (let j = 0; j < collections.length; j++) {
            let fromCol = fromClient.db(dbList[i].name).collection(collections[j]);
            let toCol = toClient.db(dbList[i].name).collection(collections[j]);
            let fn = null;

            const cursor = fromCol.find();
            for await (let doc of cursor) {
                //console.log(`Found record: ${JSON.stringify(doc, null, 4)}`);
                if (fn) {
                    // @ts-ignore
                    doc = fn(doc);
                }
                let ret = await toCol.insertOne(doc);
                if (ret.result.ok !== 1) {
                    console.log(`InsertOne failed: ${ret.result}`);
                }
            }
        }
        console.log(`Done copying: ${dbList[i].name}`);
    }

    dbList = await to.listDatabases();
    console.log("Done copy. Database List on destination: ", dbList);
}

// First, make sure no dbs are there in the destination. Use the below
// if needed. 
//deleteAll('mongodb://in-datagroom-vd:27017');

// Now copy everything. 
doIt('mongodb://in-mvlb52:27017', 'mongodb://in-datagroom-vd:27017');

// After this, do an 'scp' to copy all attachments...
