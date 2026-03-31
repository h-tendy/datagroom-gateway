const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Datagroom Gateway API',
            version: '1.0.0',
            description: 'API documentation for the Datagroom Gateway — a dataset management platform backed by MongoDB with Jira integration, Excel/CSV import, and attachment support.',
        },
        servers: [
            {
                url: '/',
                description: 'Current server',
            },
        ],
        tags: [
            { name: 'Auth', description: 'Authentication and session management' },
            { name: 'Datasets', description: 'Dataset CRUD, views, filters, columns, bulk edit, export, and Jira integration' },
            { name: 'Upload', description: 'Excel file upload and dataset creation' },
            // { name: 'Upload CSV', description: 'CSV file upload and dataset creation' },
            { name: 'Attachments', description: 'File attachment upload, serving, and deletion' },
            { name: 'PAT', description: 'Personal Access Token (PAT) management - generate, list, view, and revoke API tokens' },
        ],
        components: {
            securitySchemes: {
                cookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'jwt',
                    description: 'JWT token stored in an httpOnly cookie after login',
                },
                basicAuth: {
                    type: 'http',
                    scheme: 'basic',
                    description: 'Basic authentication (e.g. abcd/abcd)',
                },
            },
            schemas: {
                DatasetIdentifier: {
                    type: 'object',
                    properties: {
                        dsName:  { type: 'string', description: 'Dataset (database) name' },
                        dsView:  { type: 'string', description: 'View name (usually "default")' },
                        dsUser:  { type: 'string', description: 'Username performing the operation' },
                    },
                    required: ['dsName', 'dsView', 'dsUser'],
                },
                PaginationQuery: {
                    type: 'object',
                    properties: {
                        filters: {
                            type: 'array',
                            description: 'Array of filter objects',
                            items: {
                                type: 'object',
                                properties: {
                                    field: { type: 'string', description: 'Column to filter on' },
                                    type: {
                                        type: 'string',
                                        enum: ['like', 'gt', 'lt', 'eq', '='],
                                        description: 'Type of filter'
                                    },
                                    value: { type: 'string', description: 'Value to filter on (can be a valid regex or date string)' }
                                },
                                required: ['field', 'type', 'value']
                            }
                        },
                        sorters: {
                            type: 'array',
                            description: 'Array of sort objects',
                            items: {
                                type: 'object',
                                properties: {
                                    field: { type: 'string', description: 'Column to sort on' },
                                    dir: {
                                        type: 'string',
                                        enum: ['asc', 'desc'],
                                        description: 'Sort direction'
                                    }
                                },
                                required: ['field', 'dir']
                            }
                        },
                        page: {
                            type: 'integer',
                            required: true,
                            description: 'Which page number to fetch'
                        },
                        per_page: {
                            type: 'integer',
                            required: true,
                            description: 'Number of records per page'
                        },
                        chronology: {
                            type: 'string',
                            enum: ['asc', 'desc'],
                            default: 'desc',
                            description: 'desc for latest record. asc for oldest record. (Overriden by sorter chronology)'
                        },
                        fetchAllMatchingRecords: {
                            type: 'string',
                            enum: ['true', 'false'],
                            default: 'false',
                            description: 'Whether to fetch all matching records (overrides page and per_page)'
                        }
                    }
                },
                StatusResponse: {
                    type: 'object',
                    properties: {
                        status: { type: 'string', enum: ['success', 'fail'] },
                        message: { type: 'string' },
                    },
                },
                ErrorResponse: {
                    type: 'object',
                    properties: {
                        Error: { type: 'string' },
                    },
                },
            },
        },
        security: [
            { cookieAuth: [] },
            { basicAuth: [] },
        ],
    },
    apis: ['./server.js', './routes/*.js'],
};

module.exports = swaggerOptions;
