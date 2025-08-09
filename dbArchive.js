const logger = require('./logger');

const MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
const ARCHIVE_CONFIG_LIST = require('./archiveConfig');

class DbArchiveProcessor {

    static _instance = null;

    constructor(io) {
        //Enforce singleton, if an instance exists, return it.
        if (DbArchiveProcessor._instance) {
            return DbArchiveProcessor._instance;
        }
        // If no instance exists, set the current instance as the singleton object
        DbArchiveProcessor._instance = this;

        this.url = process.env.DATABASE || 'mongodb://localhost:27017';
        this.io = io;
        this.dbConnectedState = false;
        this.client = null;
    }

    resetConnectionState() {
        this.dbConnectedState = false;
        this.client = null;
    }

    async destroy () {
        if (this.isConnected) {
            try {
                await this.client.close(true);
                logger.warn("MongoDbArchive: Client is closing the connection");
                this.resetConnectionState();
                DbAbstraction._instance = null;
            } catch(err) {
                logger.error(err, "Exception while closing the client connection to MongoDbArchive");
            }
        } else {
            logger.info("MongoDbArchive: No active connection to close");
        }
    }

    async connect () {
        if (this.isConnected && this.client && this.client.topology 
            && this.client.topology.isConnected()) {
            logger.debug('Already a client connection to DB. Reusing this');
            return;
        }

        if (this.connectionPromise) {
            logger.warn('MongoDbArchive: Connection in progress, waiting for it to complete');
            await this.connectionPromise;
            return;
        }

        logger.info('MongoDbArchive: Initialising new client connection');
        try {
            this.client = new MongoClient(this.url, {
                maxPoolSize: 10, //Maintain upto 10 sockets
                minPoolSize: 3, // Keep at least 3 connections open
                useNewUrlParser: true, 
                useUnifiedTopology: true, 
                serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds if server not found
                socketTimeoutMS: 45000 //Close sockets after 45s of inactivity
            });
            
            this.connectionPromise = this.client.connect();
            
            await this.connectionPromise;

            this.isConnected = true;

            logger.info("MongoDbArchive: Succesfully connected");

            this.client.on('connectionPoolCreated', () => logger.info('MongoDbArchive: Connection pool created.'));
            this.client.on('connectionPoolClosed', () => logger.info('MongoDbArchive: Connection pool closed.'));
            this.client.on('connectionCreated', () => logger.info('MongoDbArchive: New connection created in pool.'));
            this.client.on('connectionClosed', () => logger.info('MongoDbArchive: Connection closed from pool.'));
            this.client.on('connectionReady', () => logger.info('MongoDbArchive: Connection ready for use.'));
            this.client.on('error', (err) => logger.error(err, 'MongoDbArchive: Client error:'));
            this.client.on('timeout', () => logger.warn('MongoDbArchive: Connection timeout!'));
            this.client.on('close', () => {
                logger.warn("MongoDbArchive: Connection closed");
                this.resetConnectionState();
                DbAbstraction._instance = null;
            });
        } catch (err) {
            logger.error(err, "MongoDbArchive: Error while creating client connection");
            this.resetConnectionState();
            DbAbstraction._instance = null;
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
            let cutOffDate = this.parseAndValidateDate(date);
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
     * Validates a date string in "dd-mm-yyyy" format and returns a local Date object.
     * @param {string} dateString The date string to validate.
     * @returns {Object} The local Date object.
     */
    parseAndValidateDate(dateString) {
        // Regular expression to match dd-mm-yyyy format
        const dateRegex = /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-(\d{4})/;

        // Check if the format is correct
        if (!dateRegex.test(dateString)) {
            return { error: new Error('Invalid date format. Expected format is "dd-mm-yyyy".')} ;
        }

        // Parse the day, month, and year from the string
        const parts = dateString.split('-');
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);

        // Construct a new Date object in the local timezone.
        // Note: The month in a Date object is 0-indexed (0 = January).
        const date = new Date(year, month - 1, day);

        // Final validation: check if the constructed date values match the input values.
        // This catches invalid dates like '31-02-2023', which would otherwise be parsed as '03-03-2023'.
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            return {error: new Error('Invalid date value. The date does not exist (e.g., February 30th).') };
        }
        return {date};
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
}

module.exports = DbArchiveProcessor;