// Can't use strict because of certain mongodb API will be too rigid otherwise. 
// "use strict";

const MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;

class DbAbstraction {
    constructor () {
        this.url = process.env.DATABASE || 'mongodb://localhost:27017';
        this.client = null;
    }
    async destroy () {
        if (this.client) {
            await this.client.close(true);
            this.client = null;
        }
    }
    async connect () {
        this.client = await MongoClient.connect(this.url, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 5000 })
            .catch(err => { console.log(err); this.client = null; });
    }
    async createDb (dbName) {
        if (! this.client ) await this.connect();
        this.client.db(dbName);
    }
    async deleteDb (dbName) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        return await db.dropDatabase();
    }
    async deleteTable (dbName, tableName) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        let ret = await collection.drop();
        return ret.result;

    }
    async createTable (dbName, tableName) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        db.collection(tableName);
    }
    // Only double-quotes need to be escaped while inserting data rows. 
    // And don't allow column names which start with underscore. Or at least don't allow _id
    async insertOne (dbName, tableName, doc) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        let ret = await collection.insertOne(doc);
        return ret.result;
    }
    async insertOneUniquely (dbName, tableName, selector, setObj) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"]) {
            console.log('insertOneUniquely error: Must not have _id');
            return { result: { ok: 0 }, message: 'setObj must not have _id' }
        }
        let ret = await collection.updateOne(selector, { $setOnInsert: setObj }, { upsert: true });
        return ret.result;
    }
    async update (dbName, tableName, selector, updateObj) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        return await collection.updateMany(selector, { $set: updateObj }, { upsert: true });
    }
    async updateOne (dbName, tableName, selector, updateObj, convertId = true) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"] && convertId) {
            selector["_id"] = new ObjectId(selector["_id"]);
        }
        let ret = await collection.updateOne(selector, { $set: updateObj }, {});
        return ret.result;
    }

    async unsetOne (dbName, tableName, selector, unsetObj, convertId = true) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"] && convertId) {
            selector["_id"] = new ObjectId(selector["_id"]);
        }
        let ret = await collection.updateOne(selector, { $unset: unsetObj }, {});
        return ret.result;
    }

    async updateOneKeyInTransaction (dbName, tableName, selector, updateObj) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        const session = this.client.startSession();
        let ret = {}; 
        try {
            await session.withTransaction(async () => {
                let collection = db.collection(tableName);
                let query = JSON.parse(JSON.stringify(selector));
                delete query["_id"];
                // See if the new object already exists
                query = {...query, ...updateObj};
                console.log("Query obj: ", query);
                let data = await this.find (dbName, tableName, query, {} );
                console.log("Find result: ", data);
                if (data.length) {
                    ret.result = { nModified: 0, error: "Key conflict" }
                } else {
                    if (selector["_id"]) {
                        selector["_id"] = new ObjectId(selector["_id"]);
                    } 
                    ret = await collection.updateOne(selector, { $set: updateObj }, {});
                }
            }, {})
    
        } finally {
            await session.endSession();
        }
        console.log("UpdateOneKeyInTransaction result:", ret.result);
        return ret.result;
    }

    async removeOne (dbName, tableName, selector) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"]) {
            selector["_id"] = new ObjectId(selector["_id"]);
        }
        let ret = await collection.deleteOne(selector);
        return ret.result;
    }

    async removeOneWithValidId (dbName, tableName, selector) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        let ret = await collection.deleteOne(selector);
        return ret.result;
    }

    async removeMany (dbName, tableName, selector, convertId = true) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"] && convertId) {
            selector["_id"] = new ObjectId(selector["_id"]);
        }
        let ret = await collection.deleteMany(selector);
        return ret.result;
    }

    async removeFieldFromAll (dbName, tableName, field) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        let unsetObj = {};
        unsetObj[field] = 1;
        let ret = await collection.updateMany({}, {$unset: unsetObj}, {});
        return ret.result;
    }

    async countDocuments (dbName, tableName, query, options) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);

        return new Promise ((resolve, reject) => {
            collection.countDocuments(query, options, (err, data) => {
                err ? reject (err) : resolve (data)
            });            
        })
    }
    getObjectId (id) {
        return new ObjectId(id);
    }
    async find (dbName, tableName, query, options) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);

        return new Promise ((resolve, reject) => {
            collection.find(query, options).toArray((err, data) => {
                err ? reject (err) : resolve (data);
            })
        })
    }

    async removeFromQuery(dbName, tableName, query, options) {
        if (! this.client ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        let count = 0;
        const cursor = collection.find(query, options);
        for await (let doc of cursor) {
            let selector = {};
            selector._id = doc._id;
            await collection.deleteOne(selector);
            count++
        }
        return count;
    }

    async pagedFind (dbName, tableName, query, options, page, limit, fetchAllMatchingRecords = false, onlyPerRowAccessCtrlQueried = false) {
        let skip = limit * (page - 1);
        let findOptions = { ...options, limit, skip };
        //console.log(dbName, tableName, query, findOptions);
        let data = await this.find (dbName, tableName, query, findOptions );
        //console.log(data);
        let total = 0;
        let totalPages = 1;
        let moreMatchingDocs = false;
        if (query && Object.keys(query).length && !fetchAllMatchingRecords && !onlyPerRowAccessCtrlQueried) {
            // If there is incoming query, then countDocuments should have the limit and skip options filled. 
            // Basically, look for limit + 1 matching document. If it is there, we can show correct pagination in UI.
            let countLimit = limit + 1;
            let countOptions = {...options, limit: countLimit, skip};
            let nextMatchingCount = await this.countDocuments(dbName, tableName, query, countOptions);
            // If there are documents more than the asked limit, it signifies there is a next page and more matching docs
            if (nextMatchingCount > limit) {
                totalPages = page + 1;
                moreMatchingDocs = true;
            } else {
                // If there are no documents more than the limit. The asked page is the last page or there are no pages at all.
                if (data.length) {
                    // If the asked page has data then it is the last page
                    totalPages = page;
                } else {
                    // If the asked page does not have data, then the previous page is total number of page.
                    if (page - 1 >= 0) {
                        totalPages = page - 1;
                    }
                }
            }
            //TODO: This total count is misleading in someways.
            total = skip + nextMatchingCount;
        } else {
            //If there is no incoming query or fetchaAllMatchingRecords is true, get the whole document count
            total = await this.countDocuments (dbName, tableName, query, options);
            totalPages = Math.ceil(total / limit);
            if (page < totalPages) {
                moreMatchingDocs = true;
            }
        }
        //console.log(total, totalPages);
        let results = { page, per_page: limit, total, total_pages: totalPages, data, moreMatchingDocs }
        //console.log(results);
        return results;
    }

    async listDatabases () {
        if (! this.client ) await this.connect();
        let dbs = await this.client.db().admin().listDatabases();
        return dbs.databases;
    }

    /**
   * Lists all the databases/dataset names according to the filter given
   * @param {string} filter 
   * @returns {Promise<Array>}
   */
    async listFilteredDatabases(filter) {
        if (!this.client) await this.connect();
        let dbs = await this.client
            .db()
            .admin()
            .listDatabases({ filter: { name: new RegExp(`^[${filter}]`, "i") } });
        return dbs.databases;
    }

    async copy (fromDsName, fromTable, toDsName, toTable, fn) {
        if (! this.client ) await this.connect();
        let fromDb = this.client.db(fromDsName);
        let toDb = this.client.db(toDsName);
        let fromCollection = fromDb.collection(fromTable);
        let toCollection = toDb.collection(toTable);

        const cursor = fromCollection.find();
        for await (let doc of cursor) {
            //console.log(`Found record: ${JSON.stringify(doc, null, 4)}`);
            if (fn) {
                doc = fn(doc);
            }
            let ret = await toCollection.insertOne(doc);
            if (ret.result.ok !== 1) {
                console.log(`InsertOne failed: ${ret.result}`);
            }
        }
    }

    async hello () {
        console.log("Hello from DbAbstraction!");
        if (! this.client ) await this.connect();
        let dbs = await this.client.db().admin().listDatabases();        
        console.log("dbs: ", dbs.databases);
        return;
    }
}

module.exports = DbAbstraction;