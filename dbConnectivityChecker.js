const logger = require('./logger');

const MongoClient = require('mongodb').MongoClient;

class DbConnectivityChecker {

    static _instance = null;

    constructor(io) {
        //Enforce singleton, if an instance exists, return it.
        if (DbConnectivityChecker._instance) {
            return DbConnectivityChecker._instance;
        }
        // If no instance exists, set the current instance as the singleton object
        DbConnectivityChecker._instance = this;

        this.url = process.env.DATABASE || 'mongodb://localhost:27017';
        this.io = io;
        this.dbConnectedState = false;
        this.client = null;
    }

    resetConnectionState() {
        this.dbConnectedState = false;
        this.client = null;
    }

    async checkDbConnectivity( dbCheckInterval ) {
        let heartBeatInterval = (dbCheckInterval * 1000);
        try {    
            this.client = new MongoClient(this.url, {
                maxPoolSize: 1,
                minPoolSize: 1, // Maintain only one connection
                useNewUrlParser: true, 
                useUnifiedTopology: true, 
                serverSelectionTimeoutMS: 4000, 
                heartbeatFrequencyMS: heartBeatInterval
            });
            
            await this.client.connect();

            this.client.on("serverHeartbeatSucceeded", () => {
                if ( this.dbConnectedState !== true) {
                    this.dbConnectedState = true;
                    this.io.emit('dbConnectivityState', { dbState: this.dbConnectedState });
                    logger.info(`Mongo db server heart beat is success, dbConnectedState : ${this.dbConnectedState}`);
                }
            });
    
            this.client.on("serverHeartbeatFailed", () => {
                if ( this.dbConnectedState !== false) {
                    this.dbConnectedState = false;
                    this.io.emit('dbConnectivityState', { dbState: this.dbConnectedState });
                    logger.info(`Mongo db server heart beat has failed, dbConnectedState : ${this.dbConnectedState}`);
                }
            });

            this.client.on('connectionPoolCreated', () => logger.info('MongoDBConnectivityChecker: Connection pool created.'));
            this.client.on('connectionPoolClosed', () => logger.info('MongoDBConnectivityChecker: Connection pool closed.'));
            this.client.on('connectionCreated', () => logger.info('MongoDBConnectivityChecker: New connection created in pool.'));
            this.client.on('connectionClosed', () => logger.info('MongoDBConnectivityChecker: Connection closed from pool.'));
            this.client.on('connectionReady', () => logger.info('MongoDBConnectivityChecker: Connection ready for use.'));
            this.client.on('error', (err) => logger.error(err, 'MongoDBConnectivityChecker: Client error:'));
            this.client.on('timeout', () => logger.warn('MongoDB: Connection timeout!'));
            this.client.on('close', () => {
                logger.warn("MongoDBConnectivityChecker: Connection closed");
                this.resetConnectionState();
                DbConnectivityChecker._instance = null;
            });
        } catch (error) {
            logger.error(error, 'Db is not up.. Exiting the process');
            process.exit(0);
        }
    }

    async destroy () {
        if (this.dbConnectedState) {
            try {
                await this.client.close(true);
                logger.warn("MongoDB Connectivity: Client is closing the connection");
                this.resetConnectionState();
                DbConnectivityChecker._instace = null;
            } catch(err) {
                logger.error(err, "MongoDB connectivity: Exception while closing the client connection to MongoDB");
            }
        } else {
            logger.info("MongoDB Connectivity: No active connection to close");
        }
    }
}

module.exports = DbConnectivityChecker;
