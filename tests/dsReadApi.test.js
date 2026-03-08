const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Comprehensive mocking to prevent hanging handles
jest.mock('../dbAbstraction');
jest.mock('../acl');
jest.mock('../logger');
jest.mock('../utils');
jest.mock('../routes/mongoFilters');
jest.mock('../userPrefs');

const DbAbstraction = require('../dbAbstraction');
const AclCheck = require('../acl');
const logger = require('../logger');
const Utils = require('../utils');
const MongoFilters = require('../routes/mongoFilters');
const UserPrefs = require('../userPrefs');
const dsReadApiRouter = require('../routes/dsReadApi');

describe('dsReadApi - /archive route', function() {
    let app;
    let mockDbAbstraction;

    beforeEach(function() {
        // Create Express app for testing
        app = express();
        app.use(express.json());
        app.use(cookieParser());
        app.use('/api', dsReadApiRouter);

        // Reset all mocks
        jest.clearAllMocks();

        // Mock logger methods
        logger.info = jest.fn();
        logger.error = jest.fn();

        // Mock Utils
        Utils.parseAndValidateDate = jest.fn();

        // Mock MongoFilters
        MongoFilters.getMongoFiltersAndSorters = jest.fn();

        // Create mock DbAbstraction instance
        mockDbAbstraction = {
            archiveData: jest.fn()
        };
        DbAbstraction.mockImplementation(() => mockDbAbstraction);
    });

    afterEach(function() {
        // Clear all timers
        jest.clearAllTimers();
        
        // Reset all mocks
        jest.resetAllMocks();
    });

    afterAll(function() {
        // Force cleanup of any remaining handles
        jest.clearAllMocks();
        jest.resetModules();
    });

    describe('POST /api/archive', function() {
        const validRequestBody = {
            sourceDataSetName: 'source-dataset',
            archiveDataSetName: 'archive-dataset',
            collectionName: 'data',
            filters: [
                {
                    field: 'cutOffDate',
                    type: 'lt',
                    value: '01-01-2024'
                }
            ]
        };

        test('should successfully archive data with valid parameters', async function() {
            // Mock ACL checks to return true
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValueOnce(true) // Source dataset access
                .mockResolvedValueOnce(true); // Archive dataset access

            // Mock date parsing
            Utils.parseAndValidateDate.mockReturnValue({
                date: new Date('2024-01-01T00:00:00.000Z')
            });

            // Mock MongoFilters
            const mockMongoFilters = { _id: { $lt: 'some-object-id' } };
            MongoFilters.getMongoFiltersAndSorters.mockReturnValue([mockMongoFilters, []]);

            // Mock successful archive operation
            mockDbAbstraction.archiveData.mockResolvedValue({
                status: 'Successfully archived 10 documents from source-dataset to archive-dataset'
            });

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(validRequestBody);

            expect(response.status).toBe(200);
            expect(response.body.status).toContain('Successfully archived');
            
            // Verify ACL checks were called
            expect(AclCheck.aclCheck).toHaveBeenCalledTimes(2);
            expect(AclCheck.aclCheck).toHaveBeenCalledWith(
                validRequestBody.sourceDataSetName,
                'default',
                undefined,
                'valid-token'
            );

            // Verify date parsing was called
            expect(Utils.parseAndValidateDate).toHaveBeenCalledWith('01-01-2024');

            // Verify MongoFilters was called
            expect(MongoFilters.getMongoFiltersAndSorters).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        field: 'cutOffDate',
                        type: 'lt',
                        value: expect.any(Date)
                    })
                ]),
                null,
                null
            );

            // Verify archive method was called with mongo filters
            expect(mockDbAbstraction.archiveData).toHaveBeenCalledWith(
                validRequestBody.sourceDataSetName,
                validRequestBody.collectionName,
                validRequestBody.archiveDataSetName,
                mockMongoFilters
            );
        });

        test('should return 400 when required parameters are missing', async function() {
            const incompleteRequestBody = {
                sourceDataSetName: 'source-dataset',
                // Missing archiveDataSetName and filters
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(incompleteRequestBody);

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('One or more required parameters is missing');
            expect(response.body.exampleRequestSpecification).toBeDefined();
            expect(response.body.exampleRequestBody).toBeDefined();

            // Verify ACL checks were not called
            expect(AclCheck.aclCheck).not.toHaveBeenCalled();
            expect(mockDbAbstraction.archiveData).not.toHaveBeenCalled();
        });

        test('should return 403 when filters array is empty', async function() {

            AclCheck.aclCheck = jest.fn()
                .mockResolvedValueOnce(true) // Source dataset access
                .mockResolvedValueOnce(true); // Archive dataset access

            
            const requestWithEmptyFilters = {
                sourceDataSetName: 'source-dataset',
                archiveDataSetName: 'archive-dataset',
                collectionName: 'data',
                filters: [] // Empty filters array
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(requestWithEmptyFilters);

            expect(response.status).toBe(403);
            expect(response.body.error).toBe('Invalid filters format. If you want to archive whole dataset give some future date in the filters.');

            // Verify ACL checks were called but archive was not
            expect(AclCheck.aclCheck).toHaveBeenCalledTimes(2);
            expect(mockDbAbstraction.archiveData).not.toHaveBeenCalled();
        });

        test('should return 400 when filters is not an array', async function() {
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValueOnce(true) // Source dataset access
                .mockResolvedValueOnce(true); // Archive dataset access
            
            const requestWithInvalidFilters = {
                sourceDataSetName: 'source-dataset',
                archiveDataSetName: 'archive-dataset',
                collectionName: 'data',
                filters: 'not-an-array'
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(requestWithInvalidFilters);

            expect(response.status).toBe(403);
            expect(response.body.error).toBe('Invalid filters format. If you want to archive whole dataset give some future date in the filters.');
        });

        test('should return 403 when cutOffDate parsing fails', async function() {
            // Mock ACL checks to return true
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValue(true);

            // Mock date parsing to return error
            Utils.parseAndValidateDate.mockReturnValue({
                error: new Error('Invalid date format')
            });

            const requestWithInvalidDate = {
                sourceDataSetName: 'source-dataset',
                archiveDataSetName: 'archive-dataset',
                collectionName: 'data',
                filters: [
                    {
                        field: 'cutOffDate',
                        type: 'lt',
                        value: 'invalid-date'
                    }
                ]
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(requestWithInvalidDate);

            expect(response.status).toBe(403);
            expect(response.body.error).toBe('Invalid cutOffDate format. Date should be in dd-mm-yyyy format');

            // Verify date parsing was called
            expect(Utils.parseAndValidateDate).toHaveBeenCalledWith('invalid-date');
            expect(mockDbAbstraction.archiveData).not.toHaveBeenCalled();
        });

        test('should return 403 when source dataset access is denied', async function() {
            // Mock ACL check to deny source dataset access
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValueOnce(false); // Source dataset access denied

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(validRequestBody);

            expect(response.status).toBe(403);
            expect(response.body.error).toBe(`${validRequestBody.sourceDataSetName} dataset access denied`);

            // Verify only one ACL check was called (for source dataset)
            expect(AclCheck.aclCheck).toHaveBeenCalledTimes(1);
            expect(mockDbAbstraction.archiveData).not.toHaveBeenCalled();
        });

        test('should return 403 when archive dataset access is denied', async function() {
            // Mock ACL checks: source allowed, archive denied
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValueOnce(true)  // Source dataset access allowed
                .mockResolvedValueOnce(false); // Archive dataset access denied

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(validRequestBody);

            expect(response.status).toBe(403);
            expect(response.body.error).toBe(`${validRequestBody.archiveDataSetName} dataset access denied`);

            // Verify both ACL checks were called
            expect(AclCheck.aclCheck).toHaveBeenCalledTimes(2);
            expect(mockDbAbstraction.archiveData).not.toHaveBeenCalled();
        });

        test('should handle database errors during archive operation', async function() {
            // Mock ACL checks to return true
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValue(true);

            // Mock date parsing
            Utils.parseAndValidateDate.mockReturnValue({
                date: new Date('2024-01-01T00:00:00.000Z')
            });

            // Mock MongoFilters
            MongoFilters.getMongoFiltersAndSorters.mockReturnValue([{}, []]);

            // Mock archive operation to return an error
            const archiveError = new Error('Database connection failed');
            mockDbAbstraction.archiveData.mockResolvedValue({
                error: archiveError
            });

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(validRequestBody);

            expect(response.status).toBe(400);
            expect(response.body.error).toBe(archiveError.message);
            expect(response.body.exampleRequestSpecification).toBeDefined();
            expect(response.body.exampleRequestBody).toBeDefined();

            // Verify archive method was called
            expect(mockDbAbstraction.archiveData).toHaveBeenCalled();
        });

        test('should handle exceptions thrown during archive operation', async function() {
            // Mock ACL checks to return true
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValue(true);

            // Mock date parsing
            Utils.parseAndValidateDate.mockReturnValue({
                date: new Date('2024-01-01T00:00:00.000Z')
            });

            // Mock MongoFilters
            MongoFilters.getMongoFiltersAndSorters.mockReturnValue([{}, []]);

            // Mock archive operation to throw an exception
            const thrownError = new Error('Unexpected database error');
            mockDbAbstraction.archiveData.mockRejectedValue(thrownError);

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(validRequestBody);

            expect(response.status).toBe(415);
            expect(response.body.err).toBe(thrownError.message);

            // Verify error was logged
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    err: thrownError.message,
                    stack: expect.any(String)
                }),
                'Exception while archiving'
            );
        });

        test('should handle filters without cutOffDate', async function() {
            // Mock ACL checks to return true
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValue(true);

            // Mock MongoFilters
            const mockMongoFilters = { status: { $eq: 'archived' } };
            MongoFilters.getMongoFiltersAndSorters.mockReturnValue([mockMongoFilters, []]);

            // Mock successful archive operation
            mockDbAbstraction.archiveData.mockResolvedValue({
                status: 'Successfully archived 5 documents'
            });

            const requestWithoutCutOffDate = {
                sourceDataSetName: 'source-dataset',
                archiveDataSetName: 'archive-dataset',
                collectionName: 'data',
                filters: [
                    {
                        field: 'status',
                        type: 'eq',
                        value: 'archived'
                    }
                ]
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(requestWithoutCutOffDate);

            expect(response.status).toBe(200);

            // Verify date parsing was not called
            expect(Utils.parseAndValidateDate).not.toHaveBeenCalled();

            // Verify MongoFilters was called with original filters
            expect(MongoFilters.getMongoFiltersAndSorters).toHaveBeenCalledWith(
                requestWithoutCutOffDate.filters,
                null,
                null
            );
        });

        test('should return correct example specification in error response', async function() {
            const incompleteRequest = {
                sourceDataSetName: 'test'
                // Missing required fields
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(incompleteRequest);

            expect(response.status).toBe(400);
            expect(response.body.exampleRequestSpecification).toEqual({
                "sourceDataSetName": "<Dataset name whose documents to be archived>",
                "collectionName": "The collection which needs to be archived. If not provided, defaults to `data`",
                "archiveDataSetName": "<Dataset name where the archive docs should go>",
                "filters": "Array of filter objects"
            });
            expect(response.body.exampleRequestBody).toEqual({
                "sourceDataSetName": "abc",
                "collectionName": "data",
                "archiveDataSetName": "abc_archive",
                "filters": [
                    {
                        "field": "cutOffDate",
                        "type": "lt",
                        "value": "17-11-2024"
                    }
                ]
            });
        });

        test('should handle multiple filters including cutOffDate', async function() {
            // Mock ACL checks to return true
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValue(true);

            // Mock date parsing
            Utils.parseAndValidateDate.mockReturnValue({
                date: new Date('2024-01-01T00:00:00.000Z')
            });

            // Mock MongoFilters
            const mockMongoFilters = { 
                _id: { $lt: 'some-object-id' },
                status: { $eq: 'completed' }
            };
            MongoFilters.getMongoFiltersAndSorters.mockReturnValue([mockMongoFilters, []]);

            // Mock successful archive operation
            mockDbAbstraction.archiveData.mockResolvedValue({
                status: 'Successfully archived 3 documents'
            });

            const requestWithMultipleFilters = {
                sourceDataSetName: 'source-dataset',
                archiveDataSetName: 'archive-dataset',
                collectionName: 'data',
                filters: [
                    {
                        field: 'cutOffDate',
                        type: 'lt',
                        value: '01-01-2024'
                    },
                    {
                        field: 'status',
                        type: 'eq',
                        value: 'completed'
                    }
                ]
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(requestWithMultipleFilters);

            expect(response.status).toBe(200);
            expect(response.body.status).toContain('Successfully archived');

            // Verify date parsing was called for cutOffDate
            expect(Utils.parseAndValidateDate).toHaveBeenCalledWith('01-01-2024');

            // Verify the filters were processed correctly
            const expectedFilters = expect.arrayContaining([
                expect.objectContaining({
                    field: 'cutOffDate',
                    type: 'lt',
                    value: expect.any(Date)
                }),
                expect.objectContaining({
                    field: 'status',
                    type: 'eq',
                    value: 'completed'
                })
            ]);
            expect(MongoFilters.getMongoFiltersAndSorters).toHaveBeenCalledWith(
                expectedFilters,
                null,
                null
            );
        });
    });

    describe('Error edge cases', function() {
        const validRequestBody = {
            sourceDataSetName: 'source-dataset',
            archiveDataSetName: 'archive-dataset',
            collectionName: 'data',
            filters: [
                {
                    field: 'cutOffDate',
                    type: 'lt',
                    value: '01-01-2024'
                }
            ]
        };

        test('should handle ACL check throwing an exception', async function() {
            // Mock ACL check to throw an exception
            AclCheck.aclCheck = jest.fn()
                .mockRejectedValue(new Error('ACL service unavailable'));

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(validRequestBody);

            expect(response.status).toBe(415);
            expect(response.body.err).toBe('ACL service unavailable');

            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    err: 'ACL service unavailable',
                    stack: expect.any(String)
                }),
                'Exception while archiving'
            );
        });

        test('should handle missing filters parameter', async function() {
            const requestWithoutFilters = {
                sourceDataSetName: 'source-dataset',
                archiveDataSetName: 'archive-dataset',
                collectionName: 'data'
                // Missing filters completely
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(requestWithoutFilters);

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('One or more required parameters is missing');
        });
    });
});

// ---------------------------------------------------------------------------
// POST /ds/pinDs  +  GET /ds/dsList graceful degradation
// ---------------------------------------------------------------------------
describe('dsReadApi - /pinDs and dsList pinned flag', function () {
    let app;
    let mockDbAbstraction;
    // Controls what req.user is set to in the injected middleware
    let mockReqUser;

    beforeEach(function () {
        app = express();
        app.use(express.json());
        app.use(cookieParser());

        // Inject req.user before the router (simulates JWT auth middleware)
        app.use((req, _res, next) => {
            req.user = mockReqUser;
            next();
        });

        app.use('/ds', dsReadApiRouter);

        jest.clearAllMocks();

        logger.info = jest.fn();
        logger.warn = jest.fn();
        logger.error = jest.fn();

        mockDbAbstraction = {
            listDatabases: jest.fn(),
            find: jest.fn(),
        };
        DbAbstraction.mockImplementation(() => mockDbAbstraction);

        // Default UserPrefs mocks — override per test as needed
        UserPrefs.getPinnedDs = jest.fn().mockResolvedValue([]);
        UserPrefs.setPinnedDs = jest.fn().mockResolvedValue(undefined);

        mockReqUser = null;
    });

    afterEach(function () {
        jest.clearAllTimers();
        jest.resetAllMocks();
    });

    // -----------------------------------------------------------------------
    // POST /ds/pinDs
    // -----------------------------------------------------------------------
    describe('POST /ds/pinDs', function () {

        test('pin: adds dataset to pinned list and returns updated list', async function () {
            mockReqUser = 'alice';
            UserPrefs.getPinnedDs.mockResolvedValue(['ds-existing']);
            UserPrefs.setPinnedDs.mockResolvedValue(undefined);

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsName: 'ds-new', dsUser: 'alice', pin: true });

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.pinnedDs).toEqual(['ds-existing', 'ds-new']);

            expect(UserPrefs.getPinnedDs).toHaveBeenCalledWith('alice');
            expect(UserPrefs.setPinnedDs).toHaveBeenCalledWith('alice', ['ds-existing', 'ds-new']);
        });

        test('pin: does not duplicate if dataset already pinned', async function () {
            mockReqUser = 'alice';
            UserPrefs.getPinnedDs.mockResolvedValue(['ds-existing']);

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsName: 'ds-existing', dsUser: 'alice', pin: true });

            expect(response.status).toBe(200);
            expect(response.body.pinnedDs).toEqual(['ds-existing']);
            // setPinnedDs still called but list unchanged
            expect(UserPrefs.setPinnedDs).toHaveBeenCalledWith('alice', ['ds-existing']);
        });

        test('unpin: removes dataset from pinned list', async function () {
            mockReqUser = 'alice';
            UserPrefs.getPinnedDs.mockResolvedValue(['ds-a', 'ds-b', 'ds-c']);

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsName: 'ds-b', dsUser: 'alice', pin: false });

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.pinnedDs).toEqual(['ds-a', 'ds-c']);

            expect(UserPrefs.setPinnedDs).toHaveBeenCalledWith('alice', ['ds-a', 'ds-c']);
        });

        test('unpin: returns empty list when last pin removed', async function () {
            mockReqUser = 'alice';
            UserPrefs.getPinnedDs.mockResolvedValue(['ds-only']);

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsName: 'ds-only', dsUser: 'alice', pin: false });

            expect(response.status).toBe(200);
            expect(response.body.pinnedDs).toEqual([]);
        });

        test('returns 400 when dsName is missing', async function () {
            mockReqUser = 'alice';

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsUser: 'alice', pin: true }); // no dsName

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('dsName and dsUser are required');
            expect(UserPrefs.getPinnedDs).not.toHaveBeenCalled();
            expect(UserPrefs.setPinnedDs).not.toHaveBeenCalled();
        });

        test('returns 400 when dsUser is missing', async function () {
            mockReqUser = 'alice';

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsName: 'ds-a', pin: true }); // no dsUser

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('dsName and dsUser are required');
        });

        test('returns 403 when JWT user does not match dsUser', async function () {
            mockReqUser = 'alice'; // JWT identity

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsName: 'ds-a', dsUser: 'bob', pin: true }); // different user

            expect(response.status).toBe(403);
            expect(response.body.error).toBe('Forbidden: user mismatch');
            expect(UserPrefs.getPinnedDs).not.toHaveBeenCalled();
            expect(UserPrefs.setPinnedDs).not.toHaveBeenCalled();
        });

        test('returns 403 when req.user is absent (unauthenticated)', async function () {
            mockReqUser = null; // no authenticated user

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsName: 'ds-a', dsUser: 'alice', pin: true });

            expect(response.status).toBe(403);
            expect(response.body.error).toBe('Forbidden: user mismatch');
        });

        test('returns 500 when setPinnedDs throws (DB failure)', async function () {
            mockReqUser = 'alice';
            UserPrefs.getPinnedDs.mockResolvedValue([]);
            UserPrefs.setPinnedDs.mockRejectedValue(new Error('MongoDB write error'));

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsName: 'ds-a', dsUser: 'alice', pin: true });

            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Failed to update pin');
            expect(logger.error).toHaveBeenCalled();
        });

        test('continues with empty list when getPinnedDs throws, then persists update', async function () {
            mockReqUser = 'alice';
            // Read fails — should not abort the request
            UserPrefs.getPinnedDs.mockRejectedValue(new Error('Read error'));
            UserPrefs.setPinnedDs.mockResolvedValue(undefined);

            const response = await request(app)
                .post('/ds/pinDs')
                .set('Cookie', ['jwt=valid-token'])
                .send({ dsName: 'ds-a', dsUser: 'alice', pin: true });

            // Falls back to empty list, pins ds-a, succeeds
            expect(response.status).toBe(200);
            expect(response.body.pinnedDs).toEqual(['ds-a']);
            expect(logger.warn).toHaveBeenCalled();
            expect(UserPrefs.setPinnedDs).toHaveBeenCalledWith('alice', ['ds-a']);
        });
    });

    // -----------------------------------------------------------------------
    // GET /ds/dsList/:dsUser — pinned flag + graceful degradation
    // -----------------------------------------------------------------------
    describe('GET /ds/dsList/:dsUser - pinned flag', function () {

        const mockDbs = [
            { name: 'admin', sizeOnDisk: 0 },
            { name: '_dg_user_prefs', sizeOnDisk: 0 },
            { name: 'dataset-alpha', sizeOnDisk: 10240 },
            { name: 'dataset-beta', sizeOnDisk: 20480 },
        ];

        function setupDbMocks() {
            mockDbAbstraction.listDatabases.mockResolvedValue(mockDbs);
            // find() is called twice per dataset: aclConfig then perms
            mockDbAbstraction.find.mockImplementation((_db, _coll, selector) => {
                if (selector._id === 'aclConfig') return Promise.resolve([]);     // no ACL
                if (selector._id === 'perms')    return Promise.resolve([{ _id: 'perms', owner: 'alice' }]);
                return Promise.resolve([]);
            });
        }

        test('returns pinned:true for datasets in user pin list', async function () {
            setupDbMocks();
            UserPrefs.getPinnedDs.mockResolvedValue(['dataset-alpha']);

            const response = await request(app)
                .get('/ds/dsList/alice')
                .set('Cookie', ['jwt=valid-token']);

            expect(response.status).toBe(200);
            const list = response.body.dbList;
            const alpha = list.find(d => d.name === 'dataset-alpha');
            const beta  = list.find(d => d.name === 'dataset-beta');

            expect(alpha.pinned).toBe(true);
            expect(beta.pinned).toBe(false);
        });

        test('all pinned:false when user has no pins', async function () {
            setupDbMocks();
            UserPrefs.getPinnedDs.mockResolvedValue([]);

            const response = await request(app)
                .get('/ds/dsList/alice')
                .set('Cookie', ['jwt=valid-token']);

            expect(response.status).toBe(200);
            response.body.dbList.forEach(d => expect(d.pinned).toBe(false));
        });

        test('graceful degradation: all pinned:false when getPinnedDs throws', async function () {
            setupDbMocks();
            UserPrefs.getPinnedDs.mockRejectedValue(new Error('Prefs DB unavailable'));

            const response = await request(app)
                .get('/ds/dsList/alice')
                .set('Cookie', ['jwt=valid-token']);

            // Should still return 200 with the full list
            expect(response.status).toBe(200);
            expect(response.body.dbList).toHaveLength(2); // alpha and beta only (admin + _dg_user_prefs filtered)
            response.body.dbList.forEach(d => expect(d.pinned).toBe(false));

            // Warning should have been logged, not an error
            expect(logger.warn).toHaveBeenCalled();
        });

        test('_dg_user_prefs and admin DBs are excluded from the list', async function () {
            setupDbMocks();
            UserPrefs.getPinnedDs.mockResolvedValue([]);

            const response = await request(app)
                .get('/ds/dsList/alice')
                .set('Cookie', ['jwt=valid-token']);

            expect(response.status).toBe(200);
            const names = response.body.dbList.map(d => d.name);
            expect(names).not.toContain('admin');
            expect(names).not.toContain('_dg_user_prefs');
            expect(names).toContain('dataset-alpha');
            expect(names).toContain('dataset-beta');
        });
    });
});