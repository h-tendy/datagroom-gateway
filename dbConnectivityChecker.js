const MongoClient = require('mongodb').MongoClient;

class DbConnectivityChecker {
    constructor(io) {
        this.url = process.env.DATABASE || 'mongodb://localhost:27017';
        this.io = io;
        this.dbState = null;
    }
    async checkDbConnectivity( dbCheckInterval ) {
        let heartBeatInterval = (dbCheckInterval * 1000);
        const MongoDbClient = new MongoClient(this.url, { useNewUrlParser: true, useUnifiedTopology: true, 
            serverSelectionTimeoutMS: 4000, heartbeatFrequencyMS: heartBeatInterval });
        
        MongoDbClient.on("serverHeartbeatSucceeded", () => {
            const currentDbState = true; 
            if (currentDbState !== this.dbState) {
                this.dbState = currentDbState;
                this.io.emit('dbConnectivityState', { dbState: currentDbState });
                console.log(`${Date()} Mongo db server heart beat is success, currentDbState :`, currentDbState);
            }
        });

        MongoDbClient.on("serverHeartbeatFailed", () => {
            const currentDbState = false;
            if (currentDbState !== this.dbState) {
                this.dbState = currentDbState;
                this.io.emit('dbConnectivityState', { dbState: currentDbState });
                console.log(`${Date()} Mongo db server heart beat has failed, currentDbState :`, currentDbState);
            }
        });
        
        await MongoDbClient.connect();
    }
}

module.exports = DbConnectivityChecker;
