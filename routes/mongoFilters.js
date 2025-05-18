// @ts-check

//@ts-ignore
var ObjectId = require('mongodb').ObjectId; 

function getFilters(str, field) {
    let terms = [], type = '', inBrackets = 0;
    let curTerm = '', mongoFilter = {};
    console.log("getFilters with: ", str);
    try {
        for (let i = 0; i < str.length; i++) {
            if (str[i] == '(') { inBrackets++ }
            if (str[i] == ')') { inBrackets-- }
            if (str[i] == '&' && str[i+1] == '&' && inBrackets == 0) {
                terms.push(curTerm.trim()); curTerm = ''; i++;
                if (!type) {
                    type = '&&'; 
                } else if (type != '&&') {
                    throw Error('Cannot mix && and || at same level');
                }
                continue;
            }
            if (str[i] == '|' && str[i+1] == '|' && inBrackets == 0) {
                terms.push(curTerm.trim()); curTerm = ''; i++;
                if (!type) {
                    type = '||'; 
                } else if (type != '||') {
                    throw Error('Cannot mix && and || at same level');
                }
                continue;
            }
            if (!curTerm && str[i] == ' ') {
                ; // skip white-space  at start of new terms.
            } else {
                curTerm += str[i];
            }
            if (i == str.length - 1) {
                terms.push(curTerm.trim()); curTerm = '';
            }
        }
        console.log('Found terms: ', terms);
        console.log('Type is: ', type);
    } catch (e) {
        console.log(e);
        mongoFilter = {}; terms = []; type = ''
    }
    if (terms.length == 1) {
        let term = terms[0];
        let regex = term, negate = false;
        let m = regex.match(/^\s*!(.*)$/);
        if (m && m.length >= 1) {
            negate = true;
            regex = m[1];
        }
        // trim open brackets
        while (true) {
            m = regex.match(/^\s*\((.*)$/);
            if (m && m.length >= 1) {
                regex = m[1];
            } else {
                break;
            }
        }
        // trim close brackets
        while (true) {
            m = regex.match(/(.*)\)\s*$/);
            if (m && m.length >= 1) {
                regex = m[1];
            } else {
                break;
            }
        }
        if (/&&/.test(regex) || /\|\|/.test(regex)) {
            if (negate) {
                mongoFilter = { $not: getFilters(regex, field) };
            } else {
                mongoFilter = getFilters(regex, field);
            }
        } else {
            if (negate) {
                mongoFilter = { $not: {$regex: `${regex}`, $options: 'i'} };
            } else {
                mongoFilter = { $regex: `${regex}`, $options: 'i' };
            }
        }
    } else if (type == '&&') {
        let childFilters = [];
        for (let i = 0; i < terms.length; i++) {
            let childFilter = getFilters(terms[i], field);
            let withField = {};
            withField[field] = childFilter
            childFilters.push(withField);
            //childFilters.push(childFilter);
        }
        mongoFilter = { $and: [ ...childFilters ] };
    } else if (type == '||') {
        let childFilters = [];
        for (let i = 0; i < terms.length; i++) {
            let childFilter = getFilters(terms[i], field);
            let withField = {};
            withField[field] = childFilter
            childFilters.push(withField);
            //childFilters.push(childFilter);
        }
        mongoFilter = { $or: [ ...childFilters ] };
    }
    console.log("Final mongoFilter: ", JSON.stringify(mongoFilter, null, 4));
    return mongoFilter;
}

function getMongoFiltersAndSorters (qFilters, qSorters, qChronology) {
    let filters = {}, orFilters = [], andFilters = [], sorters = [];
    try {
        // if qFilters is null, we want to return an empty filter list instead of what
        // we are now returning in the exception path. 
        if (!qFilters) qFilters = [];
        qFilters.map((v) => {
            if (v.field === "_id" && (v.type === "gt" || v.type === "lt") && typeof v.value == "string") {
                // Don't entertain any other type other than greater or less than.
                if (v.type === "gt") {
                    filters[v.field] = {$gt: new ObjectId(v.value)};
                } else if (v.type === "lt") {
                    filters[v.field] = {$lt: new ObjectId(v.value)};
                }
            } else if (v.type === 'like') {
                let filter = getFilters(v.value, v.field);
                if (filter["$or"]) {
                    orFilters.push(...filter["$or"]);
                } else if (filter["$and"]) {
                    andFilters.push(...filter["$and"]);
                } else {
                    filters[v.field] = getFilters(v.value, v.field);
                }
            } else if (v.type === '=') {
                let numVal = Number(v.value);
                filters[v.field] = {$eq: numVal};
            } else if (v.type === 'eq') {
                filters[v.field] = {$eq: v.value};
            }
            /*
            if (v.value !== '' && !Number.isNaN(Number(v.value))) {
                let numVal = Number(v.value);
                filters[v.field] = {$eq: numVal};
            }*/
        })
    } catch (e) { 
        console.log("Exception in getMongoFiltersAndSorters: ", e) 
        filters["_id"] = { $eq: "" };
    }
    if (orFilters.length)
        filters["$or"] = orFilters; 
    if (andFilters.length) 
        filters["$and"] = andFilters;
    try {
        qSorters.map((v) => {
            let f = [];
            f.push(v.field); f.push(v.dir);
            sorters.push(f);
        })
    } catch (e) {}
    // Add a default sorter
    if (!sorters.length) {
        let f = []
        f.push('_id'); 
        if (qChronology)
            f.push(qChronology);
        else 
            f.push('desc');
        sorters.push(f);
    }

    return [filters, sorters]
}


module.exports = {
    getFilters,
    getMongoFiltersAndSorters
};

// Working cases
//getFilters("!(else || what", "field");
//getFilters("!(else || what)", "field");
//getFilters("!(something && else)", "field");
//getFilters("!(something &&)", "field");
//getFilters("!(something && )", "field");
//getFilters("defect.*", "field");
//getFilters("!(else) || what", "field");
//getFilters("!(else) && what && Some", "field");
//getFilters("!(else) || what && Some", "field");
//getFilters("!(else) || what || Some", "field");
//getFilters("!(else) || what || Some", "field");


