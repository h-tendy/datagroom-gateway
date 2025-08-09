// @ts-check
const path = require('path');
const fs = require('fs');
// Use http or https as per your test requirement
//const https = require('https');
const https = require('http')
const fetch = require('node-fetch');
const DOT_ENV_FILE = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: DOT_ENV_FILE });
const DG_BASIC_AUTH_CREDS = "guest:guest";
let procMap = {};

let DG_HOST = 'localhost';
let DG_PORT = '8887'

let neMapFromNeMgr = {};

let resMgrIp, resMgrPort;

if (process.argv.length >= 2) {
  for (let i = 2; i < process.argv.length; i++) {
      let argkv = process.argv[i].split('=');
      if (argkv[0] == 'resMgrIp') {
          resMgrIp = argkv[1];
      }
      if (argkv[0] == 'resMgrPort') {
          resMgrPort = parseInt(argkv[1]);
      }
      if (argkv[0] == 'dgHost') {
          DG_HOST = argkv[1];
          console.log(`${Date()}: The DG_HOST has been set to ${argkv[1]}`); 
      }
      if (argkv[0] == 'dgPort') {
          DG_PORT = argkv[1];
          console.log(`${Date()}: The DG_PORT has been set to ${argkv[1]}`); 
      }
  }
}

exports.assign = function (obj, keyPath, value) {
    let lastKeyIndex = keyPath.length-1;
    for (var i = 0; i < lastKeyIndex; ++ i) {
      let key = keyPath[i];
      if (!(key in obj)){
        obj[key] = {}
      }
      obj = obj[key];
    }
    obj[keyPath[lastKeyIndex]] = value;
}

//makes https request and returns a promise, analyse the response by parsing it as json and ensure promise always resolve with a valid json.
exports.doRequest = (options, data, isbitbucketRequest = false) => {
  if (!isbitbucketRequest) {
    options.auth = DG_BASIC_AUTH_CREDS;
  }
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.setEncoding('utf8');
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        let jsonParsed;
        try {
          jsonParsed = JSON.parse(responseBody);
        } catch (error) {
         jsonParsed = {
          status: "error",
          data:  error,
          message: "Invalid JSON response"
         }
        }
        resolve(jsonParsed);
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) req.write(data)
    req.end();
  });
}

exports.lookupFromDatagroomViaPost = async (filterData, pushOptions,page=1) => {
  let results = [];
  if (!pushOptions.dgHost || !pushOptions.dgPort || !pushOptions.lookupDsName) {
    return results;
  }
  let filters = [];
  for (let data in filterData) {
    if (filterData.hasOwnProperty(data)) {
      let value = filterData[data];
      filters.push({ field: data, type: 'like', value: value });
    }
  }
  console.log(`Calling get request via post: ${JSON.stringify(filters, null, 4)}`);
  let pagingArgs = {
    page: page,
    per_page: 100,
    filters,
    sorters: undefined,
    chronology: 'desc'
  }
  let data = new TextEncoder().encode(
    JSON.stringify(pagingArgs)
  );
  let options = {
    hostname: pushOptions.dgHost,
    port: pushOptions.dgPort,
    path: '/ds/viewViaPost/' + pushOptions.lookupDsName,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }
  let r = await exports.doRequest(options, data);
  console.log("Got request response via post");
  return r
}

exports.pushRowToDG = async (dsName, selectorObj, doc) => {
  let request = {
    dsName,
    selectorObj,
    doc
  };
  let data = new TextEncoder().encode(
    JSON.stringify(request));
  let options = {
      hostname: DG_HOST,
      port: DG_PORT,
      path: '/ds/view/insertOrUpdateOneDoc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
  }
  console.log(`${Date()}: Doing a DG update request: ${JSON.stringify(request, null, 4)}`);
  let t = await exports.doRequest(options, data);
  console.log(`${Date()}: Done DG update, response: ${JSON.stringify(t, null, 4)}`);
}

exports.deleteRowFromDG = async (dsName, selectorObj) => {
  let request = {
    dsName,
    selectorObj,
  };
  let data = new TextEncoder().encode(
    JSON.stringify(request));
  let options = {
    hostname: DG_HOST,
    port: DG_PORT,
    path: '/ds/view/deleteOneDoc',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }
  console.log("Deleting from DG : ", JSON.stringify(request, null, 4));
  let d = await exports.doRequest(options, data);
  console.log("Deleting row from DG, response: ", d);
}

var rowstoDG = [];
var pushInProgress = false;
exports.pushRowtoDGSerially =  (dsName, selectorObj,doc) =>{
    let request = {
      dsName,
      selectorObj,
      doc
    };
    let data = new TextEncoder().encode(
      JSON.stringify(request));
    let options = {
        hostname: DG_HOST,
        port: DG_PORT,
        path: '/ds/view/insertOrUpdateOneDoc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      }
    let r = {options,data};
    rowstoDG.push(r);
    if(!pushInProgress){
      console.log(`Calling drain rows to dg `);
      drainRowstoDG(request);
    }
}

async function drainRowstoDG(request)
{
  pushInProgress = true;
  while(rowstoDG.length > 0){
    let r = rowstoDG.shift();
    let options = r.options;
    let data = r.data;
    console.log(`${Date()}: Doing a DG update request serially: ${JSON.stringify(request, null, 4)}`);
    let t = await exports.doRequest(options, data);
    console.log(`${Date()}: Done DG update, response serially: ${t}`);
  }
  pushInProgress = false;
}


exports.archiveDataset = async (sourceDataSetName, archiveDataSetName, cutOffDate, collectionName = "data") => {
  /* exmaple Request Body = {
    "sourceDataSetName": "BMSCOPY",
    "collectionName": "data",
    "archiveDataSetName": "BMSCOPY_archive",
    "cutOffDate": "10-08-2025"
  } */
  let request = {
    sourceDataSetName,
    archiveDataSetName,
    collectionName,
    cutOffDate
  };
  let data = new TextEncoder().encode(
    JSON.stringify(request));
  let options = {
      hostname: DG_HOST,
      port: DG_PORT,
      path: '/ds/archive',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
  }
  console.log(`${Date()}: Doing a DG archive request: ${JSON.stringify(request, null, 4)}`);
  let t = await exports.doRequest(options, data);
  console.log(`${Date()}: Done DG update, response: ${JSON.stringify(t, null, 4)}`);
}

