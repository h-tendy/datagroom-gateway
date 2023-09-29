const MongoClient = require('mongodb').MongoClient;

class DbConnectivityChecker {
    constructor(io) {
        this.url = process.env.DATABASE || 'mongodb://0.0.0.0:27017';
        this.io = io;
    }

    async emitDbAvailable() {
        if (this.io) {
            this.io.emit('dbConnectivityState', { dbState: true });
        } else {
            console.error("Socket.io instance not available.");
        }
    }

    async emitDbUnAvailable() {
        if (this.io) {
            this.io.emit('dbConnectivityState', { dbState: false });
        } else {
            console.error("Socket.io instance not available.");
        }
    }

    async checkDbConnectivity( dbCheckInterval ) {
        let heartBeatInterval = (dbCheckInterval * 1000);
        try {
            const clientInit = new MongoClient(this.url, { useNewUrlParser: true, useUnifiedTopology: true, 
                serverSelectionTimeoutMS: 4000, heartbeatFrequencyMS: heartBeatInterval });
            
            clientInit.on ("serverHeartbeatSucceeded",() => { this.emitDbAvailable() });

            clientInit.on ("serverHeartbeatFailed",() => { this.emitDbUnAvailable();
                console.log(`${Date()} Mongo db server heart beat failed`);
            });

            await clientInit.connect();
        } catch (error) {
            console.error('Error connecting to MongoDB:', error);
        }
    }
}

module.exports = DbConnectivityChecker;
