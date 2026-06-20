import {createServer} from 'node:http';

const server = createServer((_request, response) => {
  response.end('ok');
});

server.listen(3000);
