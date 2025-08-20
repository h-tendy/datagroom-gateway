// Can't use strict because of certain mongodb API will be too rigid otherwise. 
// "use strict";

const logger = require('./logger');

const MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
const {parseAndValidateDate} = require('./utils');

class DbAbstraction {

    // Holds the singleton object of this class
    static _instance = null;

    constructor () {
        //Enforce singleton, if an instance exists, return it.
        if (DbAbstraction._instance) {
            return DbAbstraction._instance;
        }
        // If no instance exists, set the current instance as the singleton object
        DbAbstraction._instance = this;
        this.url = process.env.DATABASE || 'mongodb://localhost:27017';
        this.client = null;
        this.connectionPromise = null;
        this.isConnected = false;
    }

    resetConnectionState() {
        this.isConnected = false;
        this.client = null;
        this.connectionPromise = null;
    }

    async destroy () {
        if (this.isConnected) {
            try {
                await this.client.close(true);
                logger.warn("MongoDB: Client is closing the connection");
                this.resetConnectionState();
                DbAbstraction._instance = null;
            } catch(err) {
                logger.error(err, "Exception while closing the client connection to MongoDB");
            }
        } else {
            logger.info("MongoDB: No active connection to close");
        }
    }

    async connect () {
        if (this.isConnected && this.client && this.client.topology 
            && this.client.topology.isConnected()) {
            logger.debug('Already a client connection to DB. Reusing this');
            return;
        }

        if (this.connectionPromise) {
            logger.warn('MongoDB: Connection in progress, waiting for it to complete');
            await this.connectionPromise;
            return;
        }

        logger.info('MongoDB: Initialising new client connection');
        try {
            this.client = new MongoClient(this.url, {
                maxPoolSize: 30, //Maintain upto 10 sockets
                minPoolSize: 3, // Keep at least 3 connections open
                useNewUrlParser: true, 
                useUnifiedTopology: true, 
                serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds if server not found
                socketTimeoutMS: 45000 //Close sockets after 45s of inactivity
            });
            
            this.connectionPromise = this.client.connect();
            
            await this.connectionPromise;

            this.isConnected = true;

            logger.info("MongoDB: Succesfully connected");

            this.client.on('connectionPoolCreated', () => logger.info('MongoDB: Connection pool created.'));
            this.client.on('connectionPoolClosed', () => logger.info('MongoDB: Connection pool closed.'));
            this.client.on('connectionCreated', () => logger.info('MongoDB: New connection created in pool.'));
            this.client.on('connectionClosed', () => logger.info('MongoDB: Connection closed from pool.'));
            this.client.on('connectionReady', () => logger.info('MongoDB: Connection ready for use.'));
            this.client.on('error', (err) => logger.error(err, 'MongoDB: Client error:'));
            this.client.on('timeout', () => logger.warn('MongoDB: Connection timeout!'));
            this.client.on('close', () => {
                logger.warn("MongoDB: Connection closed");
                this.resetConnectionState();
                DbAbstraction._instance = null;
            });
        } catch (err) {
            logger.error(err, "MongoDB: Error while creating client connection");
            this.resetConnectionState();
            DbAbstraction._instance = null;
        }
    }

    async createDb (dbName) {
        if (! this.isConnected ) await this.connect();
        this.client.db(dbName);
    }
    async deleteDb (dbName) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        return await db.dropDatabase();
    }
    async deleteTable (dbName, tableName) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        let ret = await collection.drop();
        return ret.result;

    }
    async createTable (dbName, tableName) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        db.collection(tableName);
    }

    /**
     * 
     * @param {String} dbName 
     * @returns {true} If the dbName exists in the db
     * @returns {false} If the dbName doesn't exist in the db
     * @throws {Error} In case of any unexpected error
     */
    async checkIfDbExists(dbName) {
        try {
            const dbList = await this.listDatabases();
            return dbList.some(dbInfo => dbInfo.name === dbName);
        } catch (err) {
            console.log(`${Date()} Error in checkIfDbExists, Err: ${err}`);
            throw err;
        }
    }

    // Only double-quotes need to be escaped while inserting data rows. 
    // And don't allow column names which start with underscore. Or at least don't allow _id
    async insertOne (dbName, tableName, doc) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        let ret = await collection.insertOne(doc);
        return ret.result;
    }
    async insertOneUniquely (dbName, tableName, selector, setObj) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"]) {
            logger.warn('insertOneUniquely error: Must not have _id');
            return { result: { ok: 0 }, message: 'setObj must not have _id' }
        }
        let ret = await collection.updateOne(selector, { $setOnInsert: setObj }, { upsert: true });
        return ret.result;
    }
    async update (dbName, tableName, selector, updateObj) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        return await collection.updateMany(selector, { $set: updateObj }, { upsert: true });
    }
    async updateOne (dbName, tableName, selector, updateObj, convertId = true) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"] && convertId) {
            selector["_id"] = new ObjectId(selector["_id"]);
        }
        let ret = await collection.updateOne(selector, { $set: updateObj }, {});
        return ret.result;
    }

    async unsetOne (dbName, tableName, selector, unsetObj, convertId = true) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"] && convertId) {
            selector["_id"] = new ObjectId(selector["_id"]);
        }
        let ret = await collection.updateOne(selector, { $unset: unsetObj }, {});
        return ret.result;
    }

    async updateOneKeyInTransaction (dbName, tableName, selector, updateObj) {
        if (! this.isConnected ) await this.connect();
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
                logger.info(query, "Query object");
                let data = await this.find (dbName, tableName, query, {} );
                logger.info(data, "Find result for query object");
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
        logger.info(`UpdateOneKeyInTransaction result: ${ret.result}`);
        return ret.result;
    }

    async removeOne (dbName, tableName, selector) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"]) {
            selector["_id"] = new ObjectId(selector["_id"]);
        }
        let ret = await collection.deleteOne(selector);
        return ret.result;
    }

    async removeOneWithValidId (dbName, tableName, selector) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        let ret = await collection.deleteOne(selector);
        return ret.result;
    }

    async removeMany (dbName, tableName, selector, convertId = true) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        if (selector["_id"] && convertId) {
            selector["_id"] = new ObjectId(selector["_id"]);
        }
        let ret = await collection.deleteMany(selector);
        return ret.result;
    }

    async removeFieldFromAll (dbName, tableName, field) {
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);
        let unsetObj = {};
        unsetObj[field] = 1;
        let ret = await collection.updateMany({}, {$unset: unsetObj}, {});
        return ret.result;
    }

    async countDocuments (dbName, tableName, query, options) {
        if (! this.isConnected ) await this.connect();
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
        if (! this.isConnected ) await this.connect();
        let db = this.client.db(dbName);
        let collection = db.collection(tableName);

        return new Promise ((resolve, reject) => {
            collection.find(query, options).toArray((err, data) => {
                err ? reject (err) : resolve (data);
            })
        })
    }

    async removeFromQuery(dbName, tableName, query, options) {
        if (! this.isConnected ) await this.connect();
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
        //logger.info(dbName, tableName, query, findOptions);
        let data = await this.find (dbName, tableName, query, findOptions );
        //logger.info(data);
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
        //logger.info(total, totalPages);
        let results = { page, per_page: limit, total, total_pages: totalPages, data, moreMatchingDocs }
        //logger.info(results);
        return results;
    }

    async listDatabases () {
        if (! this.isConnected ) await this.connect();
        let dbs = await this.client.db().admin().listDatabases();
        return dbs.databases;
    }

    /**
   * Lists all the databases/dataset names according to the filter given
   * @param {string} filter 
   * @returns {Promise<Array>}
   */
    async listFilteredDatabases(filter) {
        if (!this.isConnected) await this.connect();
        let dbs = await this.client
            .db()
            .admin()
            .listDatabases({ filter: { name: new RegExp(`^[${filter}]`, "i") } });
        return dbs.databases;
    }

    async copy (fromDsName, fromTable, toDsName, toTable, fn) {
        if (! this.isConnected ) await this.connect();
        let fromDb = this.client.db(fromDsName);
        let toDb = this.client.db(toDsName);
        let fromCollection = fromDb.collection(fromTable);
        let toCollection = toDb.collection(toTable);

        const cursor = fromCollection.find();
        for await (let doc of cursor) {
            //logger.info(`Found record: ${JSON.stringify(doc, null, 4)}`);
            if (fn) {
                doc = fn(doc);
            }
            let ret = await toCollection.insertOne(doc);
            if (ret.result.ok !== 1) {
                logger.warn(`InsertOne failed: ${ret.result}`);
            }
        }
    }

    /**
     * @param {string} sourceDbName
     * @param {String} collectionName
     * @param {string} archiveDbName
     * @param {string} date
     * @returns {Promise<Object>}
     */
    async archiveData(sourceDbName, collectionName, archiveDbName, date) {
        try {
            if (!sourceDbName || await this.ifDbExists(sourceDbName) == false) {
                let error = new Error(`${sourceDbName} dataset doesn't exist`);
                return {error}
            }
            if (!archiveDbName || await this.ifDbExists(archiveDbName) == false) {
                let error = new Error(`${archiveDbName} dataset doesn't exist. Please make one before proceeding`);
                return {error}
            }
            if (!collectionName) {
                collectionName = "data";
            }
            let cutOffDate = parseAndValidateDate(date);
            if (cutOffDate.error) {
                return {error: cutOffDate.error}
            }
            
            logger.info(`Archiving ${archiveDbName}.${collectionName}`);
            let status = await this.archiveCollection(sourceDbName, collectionName, archiveDbName, cutOffDate.date);
            return {status}
        } catch (e) {
            logger.error(e, "MongoDbArchive: Error in archiving");
            return {error: e};
        }
    }

    /**
     * @param {string} dsName
     */
    async ifDbExists(dsName) {
        if (!this.isConnected) await this.connect();
        let dbs = await this.client.db().admin().listDatabases();
        // Check if db already exists...
        let dbList = dbs.databases;
        for (let i = 0; i < dbList.length; i++) {
            if (dbList[i].name === dsName) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param {String} sourceDbName
     * @param {String} collectionName
     * @param {String} archiveDbName
     * @param {Date} cutOffDate
     * @returns {Promise<Object>}
     */
    async archiveCollection(sourceDbName, collectionName, archiveDbName, cutOffDate) {
        let status = "";
        if (!this.isConnected) await this.connect();
        const sourceDb = this.client.db(sourceDbName);
        const archiveDb = this.client.db(archiveDbName);

        const sourceCollection = sourceDb.collection(collectionName);
        const archiveCollection = archiveDb.collection(collectionName);

        const cutOffObjectId = ObjectId.createFromTime(Math.floor(cutOffDate.getTime() / 1000));
        const query = { "_id": { $lt: cutOffObjectId } }

        const cursor = await sourceCollection.find(query).sort({ _id: 1 });
        const documentsToArchive = await cursor.toArray();

        if (documentsToArchive.length === 0) {
            logger.info(`No documents older than ${cutOffDate} in ${sourceDbName}.${collectionName} to archive.`);
            status = `No documents older than ${cutOffDate} in ${sourceDbName}.${collectionName} to archive.`;
            return status;
        }
        logger.info(`Found ${documentsToArchive.length} documents to archive from ${sourceDbName}.${collectionName}.`);
        // Insert the documents into the archive collection.
        const result = await archiveCollection.insertMany(documentsToArchive, {ordered: false});
        logger.info(`Successfully archived ${result.insertedCount} documents to ${archiveDbName}.${collectionName}.`);

        if (documentsToArchive.length === result.insertedCount) {
            logger.info(`All documents successfully archived. Moving on to delete them from original dataset`);
            // Delete the original documents from the source collection.
            const deleteResult = await sourceCollection.deleteMany(query);
            logger.info(`Successfully deleted ${deleteResult.deletedCount} documents from ${sourceDbName}.${collectionName}.`);
            status = `Successfully archived ${deleteResult.deletedCount} documents to ${archiveDbName}.${collectionName}`;
            return status;
        } else {
            status = `Successfully archived ${result.insertedCount} documents out of ${documentsToArchive.length} documents to ${archiveDbName}.${collectionName}.
            Some documents we were unable to archive. Please check manually.`;
            return status;
        }
    }

    async hello () {
        logger.info("Hello from DbAbstraction!");
        if (! this.isConnected ) await this.connect();
        let dbs = await this.client.db().admin().listDatabases();        
        logger.info(dbs.databases, "Databases list");
        return;
    }
}

module.exports = DbAbstraction;