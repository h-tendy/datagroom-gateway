const DbAbstraction = require('../dbAbstraction');
const DbTestSetup = require('./setup/dbTestSetup');

describe('DbAbstraction', function() {
    let dbTestSetup;
    let dbAbstraction;

    // Setup and teardown for the entire test suite
    beforeAll(async function() {
        dbTestSetup = new DbTestSetup();
        await dbTestSetup.startTestDb();
    }, 30000); // 30 second timeout

    afterAll(async function() {
        await dbTestSetup.stopTestDb();
    }, 30000);

    // Setup and cleanup for each individual test
    beforeEach(async function() {
        dbAbstraction = new DbAbstraction();
        await dbAbstraction.connect();
    });

    afterEach(async function() {
        await dbTestSetup.cleanTestDb();
        await dbAbstraction.destroy();
        // Reset singleton
        DbAbstraction._instance = null;
    });

    describe('Connection Management', function() {
        test('should connect to database successfully', async function() {
            expect(dbAbstraction.isConnected).toBe(true);
            expect(dbAbstraction.client).toBeTruthy();
        });

        test('should reuse existing connection', async function() {
            const firstClient = dbAbstraction.client;
            await dbAbstraction.connect(); // Try to connect again
            expect(dbAbstraction.client).toBe(firstClient);
        });

        test('should handle singleton pattern correctly', function() {
            const db1 = new DbAbstraction();
            const db2 = new DbAbstraction();
            expect(db1).toBe(db2);
        });
    });

    describe('Basic CRUD Operations', function() {
        const testDbName = 'test-database';
        const testTableName = 'test-collection';

        beforeEach(async function() {
            await dbAbstraction.createDb(testDbName);
            await dbAbstraction.createTable(testDbName, testTableName);
        });

        test('should insert a document successfully', async function() {
            const testDoc = { name: 'Test Document', value: 123 };
            
            const result = await dbAbstraction.insertOne(testDbName, testTableName, testDoc);
            
            expect(result).toBeTruthy();
            expect(result.ok).toBe(1);
        });

        test('should find inserted documents', async function() {
            const testDoc1 = { name: 'Document 1', category: 'test' };
            const testDoc2 = { name: 'Document 2', category: 'test' };
            
            await dbAbstraction.insertOne(testDbName, testTableName, testDoc1);
            await dbAbstraction.insertOne(testDbName, testTableName, testDoc2);
            
            const results = await dbAbstraction.find(testDbName, testTableName, { category: 'test' }, {});
            
            expect(results).toHaveLength(2);
            expect(results[0].name).toBe('Document 1');
            expect(results[1].name).toBe('Document 2');
        });

        test('should count documents correctly', async function() {
            const testDocs = [
                { category: 'A', value: 1 },
                { category: 'A', value: 2 },
                { category: 'B', value: 3 }
            ];
            
            for (const doc of testDocs) {
                await dbAbstraction.insertOne(testDbName, testTableName, doc);
            }
            
            const totalCount = await dbAbstraction.countDocuments(testDbName, testTableName, {}, {});
            const categoryACount = await dbAbstraction.countDocuments(testDbName, testTableName, { category: 'A' }, {});
            
            expect(totalCount).toBe(3);
            expect(categoryACount).toBe(2);
        });

        test('should update documents correctly', async function() {
            const testDoc = { name: 'Original', status: 'draft' };
            await dbAbstraction.insertOne(testDbName, testTableName, testDoc);
            
            const updateResult = await dbAbstraction.update(testDbName, testTableName, 
                { name: 'Original' }, 
                { status: 'published' }
            );
            
            expect(updateResult.modifiedCount).toBe(1);
            
            const updatedDoc = await dbAbstraction.find(testDbName, testTableName, { name: 'Original' }, {});
            expect(updatedDoc[0].status).toBe('published');
        });

        test('should delete documents correctly', async function() {
            const testDoc = { name: 'To Delete', temp: true };
            await dbAbstraction.insertOne(testDbName, testTableName, testDoc);
            
            const deleteResult = await dbAbstraction.removeOne(testDbName, testTableName, { name: 'To Delete' });
            
            expect(deleteResult.n).toBe(1);
            
            const remainingDocs = await dbAbstraction.find(testDbName, testTableName, { name: 'To Delete' }, {});
            expect(remainingDocs).toHaveLength(0);
        });
    });

    describe('Archive Functionality', function() {
        const sourceDbName = 'source-dataset';
        const archiveDbName = 'archive-dataset';
        const collectionName = 'data';

        beforeEach(async function() {
            // Create source and archive databases
            await dbAbstraction.createDb(sourceDbName);
            await dbAbstraction.createDb(archiveDbName);
            await dbAbstraction.createTable(sourceDbName, collectionName);
            await dbAbstraction.createTable(archiveDbName, collectionName);

            // IMPORTANT: Insert a dummy document to ensure the archive database actually exists
            // MongoDB only creates databases when they contain data
            const dummyDoc = { _temp: 'dummy', createdAt: new Date() };
            await dbAbstraction.insertOne(archiveDbName, collectionName, dummyDoc);
            
            // Remove the dummy document to start with a clean archive
            await dbAbstraction.removeOne(archiveDbName, collectionName, { _temp: 'dummy' });
        });

        test('should archive old documents successfully', async function() {
            // Create test documents with different ages
            const oldDate = new Date('2023-01-01');
            const recentDate = new Date('2024-06-01');
            const cutOffDate = '01-03-2024'; // March 1, 2024

            // Create ObjectIds with specific timestamps for testing
            const oldObjectId1 = dbAbstraction.getObjectId(Math.floor(oldDate.getTime() / 1000).toString(16) + '0000000000000000');
            const oldObjectId2 = dbAbstraction.getObjectId(Math.floor(oldDate.getTime() / 1000).toString(16) + '1111111111111111');
            const recentObjectId = dbAbstraction.getObjectId(Math.floor(recentDate.getTime() / 1000).toString(16) + '0000000000000000');

            // Insert old documents (should be archived)
            const oldDoc1 = { _id: oldObjectId1, data: 'old1' };
            const oldDoc2 = { _id: oldObjectId2, data: 'old2' };
            
            // Insert recent documents (should remain)
            const recentDoc = { _id: recentObjectId, data: 'recent' };

            await dbAbstraction.insertOne(sourceDbName, collectionName, oldDoc1);
            await dbAbstraction.insertOne(sourceDbName, collectionName, oldDoc2);
            await dbAbstraction.insertOne(sourceDbName, collectionName, recentDoc);

            // Verify initial state
            const initialCount = await dbAbstraction.countDocuments(sourceDbName, collectionName, {}, {});
            expect(initialCount).toBe(3);

            // Perform archive operation
            const archiveResult = await dbAbstraction.archiveData(sourceDbName, collectionName, archiveDbName, cutOffDate);

            // Verify archive was successful
            expect(archiveResult.error).toBeUndefined();
            expect(archiveResult.status).toContain('Successfully archived 2 documents');

            // Verify documents were moved to archive
            const archivedDocs = await dbAbstraction.find(archiveDbName, collectionName, {}, {});
            expect(archivedDocs).toHaveLength(2);
            expect(archivedDocs.map(function(doc) { return doc.data; })).toEqual(expect.arrayContaining(['old1', 'old2']));

            // Verify recent documents remain in source
            const remainingDocs = await dbAbstraction.find(sourceDbName, collectionName, {}, {});
            expect(remainingDocs).toHaveLength(1);
            expect(remainingDocs[0].data).toBe('recent');
        });

        test('should handle archive when no old documents exist', async function() {
            // Insert only recent documents
            const recentDate = new Date();
            const recentObjectId = dbAbstraction.getObjectId(Math.floor(recentDate.getTime() / 1000).toString(16) + '0000000000000000');
            const recentDoc = { _id: recentObjectId, data: 'recent' };
            await dbAbstraction.insertOne(sourceDbName, collectionName, recentDoc);

            const cutOffDate = '01-01-2020'; // Very old date
            const archiveResult = await dbAbstraction.archiveData(sourceDbName, collectionName, archiveDbName, cutOffDate);

            expect(archiveResult.status).toContain('No documents older than');
            
            // Verify no documents were archived
            const archivedDocs = await dbAbstraction.find(archiveDbName, collectionName, {}, {});
            expect(archivedDocs).toHaveLength(0);

            // Verify source documents remain
            const sourceDocs = await dbAbstraction.find(sourceDbName, collectionName, {}, {});
            expect(sourceDocs).toHaveLength(1);
        });

        test('should handle errors for non-existent databases', async function() {
            const result = await dbAbstraction.archiveData('nonexistent-source', collectionName, archiveDbName, '01-01-2024');
            
            expect(result.error).toBeTruthy();
            expect(result.error.message).toContain("nonexistent-source dataset doesn't exist");
        });

        test('should handle invalid date format', async function() {
            const result = await dbAbstraction.archiveData(sourceDbName, collectionName, archiveDbName, 'invalid-date');
            
            expect(result.error).toBeTruthy();
        });
    });

    describe('Paged Find Functionality', function() {
        const testDbName = 'paged-test-db';
        const testTableName = 'paged-collection';

        beforeEach(async function() {
            await dbAbstraction.createDb(testDbName);
            await dbAbstraction.createTable(testDbName, testTableName);

            // Insert test data
            const testDocs = [];
            for (let i = 1; i <= 25; i++) {
                testDocs.push({
                    name: 'Document ' + i,
                    category: i <= 15 ? 'A' : 'B',
                    value: i
                });
            }

            for (const doc of testDocs) {
                await dbAbstraction.insertOne(testDbName, testTableName, doc);
            }
        });

        test('should return correct page of results', async function() {
            const page = 2;
            const limit = 10;
            const query = {};
            const options = { sort: { value: 1 } };

            const result = await dbAbstraction.pagedFind(testDbName, testTableName, query, options, page, limit);

            expect(result.page).toBe(page);
            expect(result.per_page).toBe(limit);
            expect(result.data).toHaveLength(limit);
            expect(result.total).toBe(25);
            expect(result.total_pages).toBe(3);
            expect(result.data[0].value).toBe(11); // Second page starts at 11
        });

        test('should handle filtered paged results', async function() {
            const page = 1;
            const limit = 10;
            const query = { category: 'A' };
            const options = { sort: { value: 1 } };

            const result = await dbAbstraction.pagedFind(testDbName, testTableName, query, options, page, limit);

            expect(result.data).toHaveLength(10);
            expect(result.data.every(function(doc) { return doc.category === 'A'; })).toBe(true);
            expect(result.moreMatchingDocs).toBe(true);
        });
    });
});