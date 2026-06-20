import {createServer} from 'node:http';
import {handler} from './handler.js';

createServer(handler).listen(3000);
