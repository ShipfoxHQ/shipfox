import {defineRoute} from '@shipfox/client-shell/runtime';

function ExternalLogin() {
  return <h1>External login</h1>;
}

const route = defineRoute({component: ExternalLogin});

export default route;
