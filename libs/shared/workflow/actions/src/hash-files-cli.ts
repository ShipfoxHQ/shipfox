/**
 * The hashing process the runner starts in a job container, so a `hashFiles()` call reads the
 * files the container's steps see: `node <sdk>/hash-files-cli.js`, with the request on stdin.
 */
import {text} from 'node:stream/consumers';
import {parseHashFilesRequest, runHashFilesRequest} from '#cache/hash-files-request.js';

const request = parseHashFilesRequest(JSON.parse(await text(process.stdin)));
process.stdout.write(JSON.stringify(await runHashFilesRequest(request)));
