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
                const currentDbConnectedState = true; 
                if (currentDbConnectedState !== this.dbConnectedState) {
                    this.dbConnectedState = currentDbConnectedState;
                    this.io.emit('dbConnectivityState', { dbState: currentDbConnectedState });
                    console.log(`${Date()} Mongo db server heart beat is success, currentDbConnectedState :`, currentDbConnectedState);
                }
            });
    
            MongoDbClient.on("serverHeartbeatFailed", () => {
                const currentDbConnectedState = false;
                if (currentDbConnectedState !== this.dbConnectedState) {
                    this.dbConnectedState = currentDbConnectedState;
                    this.io.emit('dbConnectivityState', { dbState: currentDbConnectedState });
                    console.log(`${Date()} Mongo db server heart beat has failed, currentDbConnectedState :`, currentDbConnectedState);
                }
            });
            
            await MongoDbClient.connect();
        } catch (error) {
            console.error('Db is not up.. Exiting the process');
            process.exit(0);
        }
    }
}

module.exports = DbConnectivityChecker;
