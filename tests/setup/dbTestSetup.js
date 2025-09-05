const { MongoMemoryServer } = require('mongodb-memory-server');

class DbTestSetup {
    constructor() {
        this.mongoServer = null;
        this.originalDbUrl = null;
    }

    async startTestDb() {
        try {
            // Create in-memory MongoDB instance compatible with Node 12
            this.mongoServer = new MongoMemoryServer({
                instance: {
                    port: 27018,
                    dbName: 'test-db'
                },
                binary: {
                    version: '4.4.6' // Use MongoDB 4.4 for Node 12 compatibility
                }
            });

            await this.mongoServer.start();
            const uri = await this.mongoServer.getUri();
            
            // Store original DATABASE env var
            this.originalDbUrl = process.env.DATABASE;
            
            // Set test database URL
            process.env.DATABASE = uri;
            
            console.log(`Test MongoDB started at: ${uri}`);
            return uri;
        } catch (error) {
            console.error('Failed to start test database:', error);
            throw error;
        }
    }

    async stopTestDb() {
        if (this.mongoServer) {
            await this.mongoServer.stop();
            // Restore original DATABASE env var
            if (this.originalDbUrl) {
                process.env.DATABASE = this.originalDbUrl;
            } else {
                delete process.env.DATABASE;
            }
            console.log('Test MongoDB stopped');
        }
    }

    async cleanTestDb() {
        if (this.mongoServer) {
            // Clear all test data between tests
            const DbAbstraction = require('../../dbAbstraction');
            const db = new DbAbstraction();
            
            try {
                await db.connect();
                const databases = await db.listDatabases();
                
                // Drop all test databases except system ones
                for (const database of databases) {
                    if (database.name !== 'admin' && database.name !== 'local' && database.name !== 'config') {
                        await db.deleteDb(database.name);
                    }
                }
            } catch (error) {
                console.error('Error cleaning test database:', error);
            } finally {
                await db.destroy();
            }
        }
    }
}

module.exports = DbTestSetup;