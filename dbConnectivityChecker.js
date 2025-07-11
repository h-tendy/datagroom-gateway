const logger = require('./logger');

const MongoClient = require('mongodb').MongoClient;

class DbConnectivityChecker {
    constructor(io) {
        this.url = process.env.DATABASE || 'mongodb://localhost:27017';
        this.io = io;
        this.dbConnectedState = false;
    }
    async checkDbConnectivity( dbCheckInterval ) {
        
        let heartBeatInterval = (dbCheckInterval * 1000);
        try {    
            const MongoDbClient = new MongoClient(this.url, { useNewUrlParser: true, useUnifiedTopology: true, 
                serverSelectionTimeoutMS: 4000, heartbeatFrequencyMS: heartBeatInterval });
            
            MongoDbClient.on("serverHeartbeatSucceeded", () => {
                if ( this.dbConnectedState !== true) {
                    this.dbConnectedState = true;
                    this.io.emit('dbConnectivityState', { dbState: this.dbConnectedState });
                    logger.info(`Mongo db server heart beat is success, dbConnectedState : ${this.dbConnectedState}`);
                }
            });
    
            MongoDbClient.on("serverHeartbeatFailed", () => {
                if ( this.dbConnectedState !== false) {
                    this.dbConnectedState = false;
                    this.io.emit('dbConnectivityState', { dbState: this.dbConnectedState });
                    logger.info(`Mongo db server heart beat has failed, dbConnectedState : ${this.dbConnectedState}`);
                }
            });
            
            await MongoDbClient.connect();
        } catch (error) {
            logger.error(error, 'Db is not up.. Exiting the process');
            process.exit(0);
        }
    }
}

module.exports = DbConnectivityChecker;
