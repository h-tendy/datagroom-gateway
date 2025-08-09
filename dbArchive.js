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
     * @param {String[]} sourceCollectionNames
     * @param {string} archiveDbName
     * @param {number} ageInDays
     */
    async archiveData(sourceDbName, sourceCollectionNames, archiveDbName, ageInDays) {
        try {
            // First copy the metaData collection from the source db to the archive db
            await this.copyMetaDataCollToArchive(sourceDbName, archiveDbName);

            // Then for each collection call the archive collection logic
            for (const collectionName of sourceCollectionNames) {
                logger.info(`Archiving ${archiveDbName}.${collectionName}`);
                await this.archiveCollection(sourceDbName, collectionName, archiveDbName, ageInDays);
            }

        } catch (e) {
            logger.error(e, "MongoDbArchive: Error in archiving");
        } finally {
            this.destroy();
            logger.info("MongoDbArchive: Destroyed the connection");
        }
    }

    /**
     * @param {String} sourceDbName
     * @param {String} archiveDbName
     */
    async copyMetaDataCollToArchive(sourceDbName, archiveDbName) {
        if (!this.isConnected) await this.connect();
        const sourceDb = this.client.db(sourceDbName);
        const archiveDb = this.client.db(archiveDbName);

        const sourceMetaDataCollections = await sourceDb.listCollections({ name: 'metaData' }).toArray();
        if (sourceMetaDataCollections.length > 0) {
            console.log(`Copying 'metaData' collection from ${sourceDbName} to ${archiveDbName}.`);

            const sourceMetaCollection = sourceDb.collection('metaData');
            const archiveMetaCollection = archiveDb.collection('metaData');

            // Clear out any old metaData in the archive before copying
            await archiveMetaCollection.deleteMany({});

            // Find all documents in the source metaData collection
            const metaDataDocuments = await sourceMetaCollection.find({}).toArray();

            if (metaDataDocuments.length > 0) {
                // Insert all documents into the archive metaData collection
                await archiveMetaCollection.insertMany(metaDataDocuments);
                console.log(`Successfully copied ${metaDataDocuments.length} documents to 'metaData' in ${archiveDbName}.`);
            } else {
                console.log(`'metaData' collection in ${sourceDbName} is empty. Nothing to copy.`);
            }
        } else {
            console.log(`'metaData' collection not found in ${sourceDbName}. Skipping copy.`);
        }
    }

    /**
     * @param {String} sourceDbName
     * @param {String} collectionName
     * @param {String} archiveDbName
     * @param {number} ageInDays
     */
    async archiveCollection(sourceDbName, collectionName, archiveDbName, ageInDays) {
        if (!this.isConnected) await this.connect();
        const sourceDb = this.client.db(sourceDbName);
        const archiveDb = this.client.db(archiveDbName);

        const sourceCollection = sourceDb.collection(collectionName);
        const archiveCollection = archiveDb.collection(collectionName);

        const cutOffDate = new Date();
        cutOffDate.setDate(cutOffDate.getDate() - ageInDays);

        const cutOffObjectId = ObjectId.createFromTime(Math.floor(cutOffDate.getTime() / 1000));
        const query = { "_id": { $lt: cutOffObjectId } }

        const cursor = await sourceCollection.find(query).sort({ _id: 1 });
        const documentsToArchive = await cursor.toArray();

        if (documentsToArchive.length === 0) {
            logger.info(`No documents older than ${ageInDays} days in ${sourceDbName}.${collectionName} to archive.`);
            return;
        }
        logger.info(`Found ${documentsToArchive.length} documents to archive from ${sourceDbName}.${collectionName}.`);
        // Insert the documents into the archive collection.
        const result = await archiveCollection.insertMany(documentsToArchive, { ordered: true });
        logger.info(`Successfully archived ${result.insertedCount} documents to ${archiveDbName}.${collectionName}.`);

        // Delete the original documents from the source collection.
        const deleteResult = await sourceCollection.deleteMany(query);
        console.log(`Successfully deleted ${deleteResult.deletedCount} documents from ${sourceDbName}.${collectionName}.`);
    }

    /**
     * @param {{ sourceDbName: String; sourceCollectionNames: Array<String>; archiveDbName: String; ageInDays: Number; frequencyInDays: Number; }} config
     */
    scheduleArchivalForConfig(config) {
        const { sourceDbName, sourceCollectionNames, 
            archiveDbName, ageInDays, frequencyInDays } = config;
        const frequencyInMs = frequencyInDays * 24 * 60 * 60 * 1000;

        // Run the archival task
        this.archiveData(sourceDbName, sourceCollectionNames, archiveDbName, ageInDays)
            .then(() => {
                // After the task is complete, schedule the next run
                logger.info(`Next archival for ${sourceDbName} scheduled in ${frequencyInDays} days.`);
                setTimeout(() => this.scheduleArchivalForConfig(config), frequencyInMs);
            })
            .catch(err => {
                // In case of an error, still schedule the next run to keep the process alive
                logger.error(err, `Archival for ${sourceDbName} failed. Retrying in ${frequencyInDays} days.`);
                setTimeout(() => this.scheduleArchivalForConfig(config), frequencyInMs);
            });
    }

    scheduleArchival() {
        ARCHIVE_CONFIG_LIST.forEach((config)  => {
            logger.info(`Scheduling archive for ${config.sourceDbName}`);
            this.scheduleArchivalForConfig(config)
        });
    }
}

module.exports = DbArchiveProcessor;