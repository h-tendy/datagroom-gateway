const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Mock dependencies
jest.mock('../dbAbstraction');
jest.mock('../acl');
jest.mock('../logger');

const DbAbstraction = require('../dbAbstraction');
const AclCheck = require('../acl');
const logger = require('../logger');
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

    // Add afterAll hook to ensure cleanup
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
            cutOffDate: '01-01-2024'
        };

        const validParams = {
            dsUser: 'testuser'
        };

        test('should successfully archive data with valid parameters', async function() {
            // Mock ACL checks to return true
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValueOnce(true) // Source dataset access
                .mockResolvedValueOnce(true); // Archive dataset access

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
                undefined, // req.params.dsUser is undefined in this test setup
                'valid-token'
            );

            // Verify archive method was called with correct parameters
            expect(mockDbAbstraction.archiveData).toHaveBeenCalledWith(
                validRequestBody.sourceDataSetName,
                validRequestBody.collectionName,
                validRequestBody.archiveDataSetName,
                validRequestBody.cutOffDate
            );

            // Verify logging
            expect(logger.info).toHaveBeenCalledWith(
                validRequestBody,
                'Incoming request to archive dataset'
            );
        });

        test('should return 400 when required parameters are missing', async function() {
            const incompleteRequestBody = {
                sourceDataSetName: 'source-dataset',
                // Missing archiveDataSetName and cutOffDate
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

            // Mock archive operation to throw an exception
            const thrownError = new Error('Unexpected database error');
            mockDbAbstraction.archiveData.mockRejectedValue(thrownError);

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(validRequestBody);

            expect(response.status).toBe(415);
            expect(response.body.err).toBe(thrownError.message);
        });

        test('should handle missing collectionName with default value', async function() {
            // Mock ACL checks to return true
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValue(true);

            // Mock successful archive operation
            mockDbAbstraction.archiveData.mockResolvedValue({
                status: 'Successfully archived 5 documents'
            });

            const requestWithoutCollectionName = {
                sourceDataSetName: 'source-dataset',
                archiveDataSetName: 'archive-dataset',
                cutOffDate: '01-01-2024'
                // collectionName is missing
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(requestWithoutCollectionName);

            expect(response.status).toBe(200);

            // Verify archive method was called with undefined collectionName (which should default to 'data')
            expect(mockDbAbstraction.archiveData).toHaveBeenCalledWith(
                requestWithoutCollectionName.sourceDataSetName,
                undefined, // collectionName is undefined, will be handled by archiveData method
                requestWithoutCollectionName.archiveDataSetName,
                requestWithoutCollectionName.cutOffDate
            );
        });

        test('should handle missing JWT cookie', async function() {
            const response = await request(app)
                .post('/api/archive')
                // No JWT cookie set
                .send(validRequestBody);

            // The route should still process but ACL check will receive undefined token
            // This tests the behavior when no authentication is provided

            // Note: The actual behavior depends on how AclCheck.aclCheck handles undefined token
            // For this test, we'll mock it to return false
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValue(false);

            const responseWithMock = await request(app)
                .post('/api/archive')
                .send(validRequestBody);

            expect(AclCheck.aclCheck).toHaveBeenCalledWith(
                validRequestBody.sourceDataSetName,
                'default',
                undefined,
                undefined // No JWT token
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
                "cutOffDate": "Date in format dd-mm-yyyy"
            });
            expect(response.body.exampleRequestBody).toEqual({
                "sourceDataSetName": "abc",
                "collectionName": "data",
                "archiveDataSetName": "abc_archive",
                "cutOffDate": "17-11-2024"
            });
        });

        test('should handle empty request body', async function() {
            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('One or more required parameters is missing');
        });

        test('should handle null values in request body', async function() {
            const requestWithNulls = {
                sourceDataSetName: null,
                archiveDataSetName: 'archive-dataset',
                cutOffDate: '01-01-2024'
            };

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(requestWithNulls);

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('One or more required parameters is missing');
        });

        test('should handle archive operation with no documents to archive', async function() {
            // Mock ACL checks to return true
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValue(true);

            // Mock archive operation returning no documents archived
            mockDbAbstraction.archiveData.mockResolvedValue({
                status: 'No documents older than 01-01-2024 found in source-dataset'
            });

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=valid-token'])
                .send(validRequestBody);

            expect(response.status).toBe(200);
            expect(response.body.status).toContain('No documents older than');
        });
    });

    describe('Error edge cases', function() {
        const validRequestBody = {
            sourceDataSetName: 'source-dataset',
            archiveDataSetName: 'archive-dataset',
            collectionName: 'data',
            cutOffDate: '01-01-2024'
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
        });

        test('should handle malformed JWT cookie', async function() {
            AclCheck.aclCheck = jest.fn()
                .mockResolvedValue(false);

            const response = await request(app)
                .post('/api/archive')
                .set('Cookie', ['jwt=malformed-token'])
                .send(validRequestBody);

            // Should attempt ACL check with malformed token
            expect(AclCheck.aclCheck).toHaveBeenCalledWith(
                validRequestBody.sourceDataSetName,
                'default',
                undefined,
                'malformed-token'
            );
        });
    });
});