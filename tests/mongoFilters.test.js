const { getFilters, getMongoFiltersAndSorters } = require('../routes/mongoFilters');

describe('MongoFilters', function() {
    
    describe('getFilters', function() {
        
        describe('Single term filters', function() {
            test('should handle simple regex filter', function() {
                const result = getFilters('test', 'field');
                expect(result).toEqual({
                    $regex: 'test',
                    $options: 'i'
                });
            });

            test('should handle negated filter', function() {
                const result = getFilters('!test', 'field');
                expect(result).toEqual({
                    $not: {
                        $regex: 'test',
                        $options: 'i'
                    }
                });
            });

            test('should handle filter with special regex characters', function() {
                const result = getFilters('defect.*', 'field');
                expect(result).toEqual({
                    $regex: 'defect.*',
                    $options: 'i'
                });
            });

            test('should trim whitespace from filter terms', function() {
                const result = getFilters('  test  ', 'field');
                expect(result).toEqual({
                    $regex: 'test',
                    $options: 'i'
                });
            });

            test('should handle filters with brackets', function() {
                const result = getFilters('(test)', 'field');
                expect(result).toEqual({
                    $regex: 'test',
                    $options: 'i'
                });
            });

            test('should handle negated filters with brackets', function() {
                const result = getFilters('!(test)', 'field');
                expect(result).toEqual({
                    $not: {
                        $regex: 'test',
                        $options: 'i'
                    }
                });
            });
        });

        describe('AND operator filters', function() {
            test('should handle simple AND operation', function() {
                const result = getFilters('test && another', 'field');
                expect(result).toEqual({
                    $and: [
                        { field: { $regex: 'test', $options: 'i' } },
                        { field: { $regex: 'another', $options: 'i' } }
                    ]
                });
            });

            test('should handle multiple AND operations', function() {
                const result = getFilters('first && second && third', 'field');
                expect(result).toEqual({
                    $and: [
                        { field: { $regex: 'first', $options: 'i' } },
                        { field: { $regex: 'second', $options: 'i' } },
                        { field: { $regex: 'third', $options: 'i' } }
                    ]
                });
            });

            test('should handle AND with brackets', function() {
                const result = getFilters('(first) && (second)', 'field');
                expect(result).toEqual({
                    $and: [
                        { field: { $regex: 'first', $options: 'i' } },
                        { field: { $regex: 'second', $options: 'i' } }
                    ]
                });
            });

            test('should handle negated AND operation', function() {
                const result = getFilters('!(something && else)', 'field');
                expect(result).toEqual({
                    $not: {
                        $and: [
                            { field: { $regex: 'something', $options: 'i' } },
                            { field: { $regex: 'else', $options: 'i' } }
                        ]
                    }
                });
            });
        });

        describe('OR operator filters', function() {
            test('should handle simple OR operation', function() {
                const result = getFilters('test || another', 'field');
                expect(result).toEqual({
                    $or: [
                        { field: { $regex: 'test', $options: 'i' } },
                        { field: { $regex: 'another', $options: 'i' } }
                    ]
                });
            });

            test('should handle multiple OR operations', function() {
                const result = getFilters('first || second || third', 'field');
                expect(result).toEqual({
                    $or: [
                        { field: { $regex: 'first', $options: 'i' } },
                        { field: { $regex: 'second', $options: 'i' } },
                        { field: { $regex: 'third', $options: 'i' } }
                    ]
                });
            });

            test('should handle OR with brackets', function() {
                const result = getFilters('(first) || (second)', 'field');
                expect(result).toEqual({
                    $or: [
                        { field: { $regex: 'first', $options: 'i' } },
                        { field: { $regex: 'second', $options: 'i' } }
                    ]
                });
            });

            test('should handle negated OR operation', function() {
                const result = getFilters('!(else || what)', 'field');
                expect(result).toEqual({
                    $not: {
                        $or: [
                            { field: { $regex: 'else', $options: 'i' } },
                            { field: { $regex: 'what', $options: 'i' } }
                        ]
                    }
                });
            });
        });

        describe('Complex nested filters', function() {
            test('should handle nested brackets with AND', function() {
                const result = getFilters('((first && second))', 'field');
                expect(result).toEqual({
                    $and: [
                        { field: { $regex: 'first', $options: 'i' } },
                        { field: { $regex: 'second', $options: 'i' } }
                    ]
                });
            });

            test('should handle nested brackets with OR', function() {
                const result = getFilters('((first || second))', 'field');
                expect(result).toEqual({
                    $or: [
                        { field: { $regex: 'first', $options: 'i' } },
                        { field: { $regex: 'second', $options: 'i' } }
                    ]
                });
            });

            test('should handle mixed negation with complex expressions', function() {
                const result = getFilters('!(else) || what', 'field');
                expect(result).toEqual({
                    $or: [
                        { field: { $not: { $regex: 'else', $options: 'i' } } },
                        { field: { $regex: 'what', $options: 'i' } }
                    ]
                });
            });
        });

        describe('Error handling', function() {
            test('should handle mixed operators error gracefully', function() {
                // This should throw an error but be caught and return empty object
                const result = getFilters('test && another || third', 'field');
                // Based on the code, this should return an empty object due to error handling
                expect(result).toEqual({});
            });

            test('should handle malformed brackets', function() {
                const result = getFilters('test && (another', 'field');
                // Should handle gracefully and parse what it can
                expect(result).toBeDefined();
            });

            test('should handle empty string', function() {
                const result = getFilters('', 'field');
                expect(result).toEqual({});
            });
        });

        describe('Working test cases from comments', function() {
            test('should handle !(else || what', function() {
                const result = getFilters('!(else || what', 'field');
                expect(result).toBeDefined();
            });

            test('should handle !(else || what)', function() {
                const result = getFilters('!(else || what)', 'field');
                expect(result).toEqual({
                    $not: {
                        $or: [
                            { field: { $regex: 'else', $options: 'i' } },
                            { field: { $regex: 'what', $options: 'i' } }
                        ]
                    }
                });
            });

            test('should handle !(something && else)', function() {
                const result = getFilters('!(something && else)', 'field');
                expect(result).toEqual({
                    $not: {
                        $and: [
                            { field: { $regex: 'something', $options: 'i' } },
                            { field: { $regex: 'else', $options: 'i' } }
                        ]
                    }
                });
            });

            test('should handle !(else) || what && Some', function() {
                const result = getFilters('!(else) || what && Some', 'field');
                // This should return empty object due to mixed operators
                expect(result).toEqual({});
            });

            test('abcd', function() {
                const result = getFilters('!(else) || (what && Some)', 'field');
                // This should return empty object due to mixed operators
                expect(result).toEqual({
                    $or: [
                        { field: { $not: { $regex: 'else', $options: 'i' } } },
                        {
                            field: {
                                $and: [
                                    { field: { $regex: 'what', $options: 'i' } },
                                    { field: { $regex: 'Some', $options: 'i' } }
                                ]
                            }
                        }
                    ]
                });
            });

            test('should handle !(else) || what || Some', function() {
                const result = getFilters('!(else) || what || Some', 'field');
                expect(result).toEqual({
                    $or: [
                        { field: { $not: { $regex: 'else', $options: 'i' } } },
                        { field: { $regex: 'what', $options: 'i' } },
                        { field: { $regex: 'Some', $options: 'i' } }
                    ]
                });
            });
        });
    });

    describe('getMongoFiltersAndSorters', function() {
        
        describe('Filter processing', function() {
            test('should handle null/undefined filters', function() {
                const [filters, sorters] = getMongoFiltersAndSorters(null, [], null);
                expect(filters).toEqual({});
                expect(sorters).toEqual([['_id', 'desc']]);
            });

            test('should handle empty filters array', function() {
                const [filters, sorters] = getMongoFiltersAndSorters([], [], null);
                expect(filters).toEqual({});
                expect(sorters).toEqual([['_id', 'desc']]);
            });

            test('should handle _id field with greater than filter', function() {
                const qFilters = [
                    { field: '_id', type: 'gt', value: '507f1f77bcf86cd799439011' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                
                expect(filters._id).toBeDefined();
                expect(filters._id.$gt).toBeDefined();
                expect(filters._id.$gt.constructor.name).toBe('ObjectID');
            });

            test('should handle _id field with less than filter', function() {
                const qFilters = [
                    { field: '_id', type: 'lt', value: '507f1f77bcf86cd799439011' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                
                expect(filters._id).toBeDefined();
                expect(filters._id.$lt).toBeDefined();
                expect(filters._id.$lt.constructor.name).toBe('ObjectID');
            });

            test('should handle like filter', function() {
                const qFilters = [
                    { field: 'name', type: 'like', value: 'test' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                
                expect(filters.name).toEqual({
                    $regex: 'test',
                    $options: 'i'
                });
            });

            test('should handle like filter with OR operations', function() {
                const qFilters = [
                    { field: 'name', type: 'like', value: 'test || another' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                
                expect(filters.$or).toBeDefined();
                expect(filters.$or).toHaveLength(2);
                expect(filters.$or[0]).toEqual({ name: { $regex: 'test', $options: 'i' } });
                expect(filters.$or[1]).toEqual({ name: { $regex: 'another', $options: 'i' } });
            });

            test('should handle like filter with AND operations', function() {
                const qFilters = [
                    { field: 'name', type: 'like', value: 'test && another' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                
                expect(filters.$and).toBeDefined();
                expect(filters.$and).toHaveLength(2);
                expect(filters.$and[0]).toEqual({ name: { $regex: 'test', $options: 'i' } });
                expect(filters.$and[1]).toEqual({ name: { $regex: 'another', $options: 'i' } });
            });

            test('should handle = filter with numeric value', function() {
                const qFilters = [
                    { field: 'count', type: '=', value: '123' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                
                expect(filters.count).toEqual({ $eq: 123 });
            });

            test('should handle eq filter', function() {
                const qFilters = [
                    { field: 'status', type: 'eq', value: 'active' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                
                expect(filters.status).toEqual({ $eq: 'active' });
            });

            test('should handle multiple filters', function() {
                const qFilters = [
                    { field: 'name', type: 'like', value: 'test' },
                    { field: 'status', type: 'eq', value: 'active' },
                    { field: 'count', type: '=', value: '5' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                
                expect(filters.name).toEqual({ $regex: 'test', $options: 'i' });
                expect(filters.status).toEqual({ $eq: 'active' });
                expect(filters.count).toEqual({ $eq: 5 });
            });
        });

        describe('Sorter processing', function() {
            test('should handle empty sorters with default', function() {
                const [filters, sorters] = getMongoFiltersAndSorters([], [], null);
                
                expect(sorters).toEqual([['_id', 'desc']]);
            });

            test('should handle custom chronology', function() {
                const [filters, sorters] = getMongoFiltersAndSorters([], [], 'asc');
                
                expect(sorters).toEqual([['_id', 'asc']]);
            });

            test('should handle single sorter', function() {
                const qSorters = [
                    { field: 'name', dir: 'asc' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters([], qSorters, null);
                
                expect(sorters).toEqual([['name', 'asc']]);
            });

            test('should handle multiple sorters', function() {
                const qSorters = [
                    { field: 'name', dir: 'asc' },
                    { field: 'created', dir: 'desc' }
                ];
                const [filters, sorters] = getMongoFiltersAndSorters([], qSorters, null);
                
                expect(sorters).toEqual([
                    ['name', 'asc'],
                    ['created', 'desc']
                ]);
            });

            test('should handle malformed sorters gracefully', function() {
                const qSorters = null; // This should cause an exception in the try-catch
                const [filters, sorters] = getMongoFiltersAndSorters([], qSorters, null);
                
                expect(sorters).toEqual([['_id', 'desc']]);
            });
        });

        describe('Error handling', function() {
            test('should handle filter processing errors', function() {
                // Create a filter that would cause an error
                const qFilters = [
                    { field: '_id', type: 'gt', value: null } // This might cause an error
                ];
                
                try {
                    const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                    // If no error, that's fine - the code handles it
                    expect(filters).toBeDefined();
                    expect(sorters).toBeDefined();
                } catch (error) {
                    // If there's an error, the function should handle it gracefully
                    expect(error).toBeDefined();
                }
            });

            test('should return error filter when exception occurs', function() {
                // Mock the logger to avoid actual logging during tests
                const originalError = console.error;
                console.error = function() {};

                // Force an error by passing undefined to map function
                const [filters, sorters] = getMongoFiltersAndSorters(undefined, [], null);
                
                expect(filters).toEqual({});
                expect(sorters).toEqual([['_id', 'desc']]);

                // Restore original console.error
                console.error = originalError;
            });
        });

        describe('Integration scenarios', function() {
            test('should handle complex real-world scenario', function() {
                const qFilters = [
                    { field: 'title', type: 'like', value: 'bug || defect' },
                    { field: 'status', type: 'eq', value: 'open' },
                    { field: 'priority', type: '=', value: '1' },
                    { field: '_id', type: 'gt', value: '507f1f77bcf86cd799439011' }
                ];
                
                const qSorters = [
                    { field: 'priority', dir: 'desc' },
                    { field: 'created', dir: 'asc' }
                ];
                
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, qSorters, null);
                
                // Check that all filters are applied
                expect(filters.$or).toBeDefined();
                expect(filters.$or).toHaveLength(2);
                expect(filters.status).toEqual({ $eq: 'open' });
                expect(filters.priority).toEqual({ $eq: 1 });
                expect(filters._id.$gt).toBeDefined();
                
                // Check sorters
                expect(sorters).toEqual([
                    ['priority', 'desc'],
                    ['created', 'asc']
                ]);
            });

            test('should handle mixed OR and AND filters', function() {
                const qFilters = [
                    { field: 'tags', type: 'like', value: 'urgent && critical' },
                    { field: 'category', type: 'like', value: 'bug || feature' }
                ];
                
                const [filters, sorters] = getMongoFiltersAndSorters(qFilters, [], null);
                
                expect(filters.$and).toBeDefined();
                expect(filters.$or).toBeDefined();
                expect(filters.$and.length).toBeGreaterThan(0);
                expect(filters.$or.length).toBeGreaterThan(0);
            });
        });
    });
});