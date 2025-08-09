
const archivalConfig = [
    //Example entry for the dataset to archive
    /* {
        "sourceDbName": "BMSCOPY",
        "sourceCollectionNames": ["data", "editlog"],
        "archiveDbName": "BMSCOPY_archive",
        "ageInDays": 30, // archive 30 days or older
        "frequencyInDays": 1 // run the archive script once every day. If it is 2, then once every 2 days.
    }, */
]

module.exports = archivalConfig;