import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_PROVISIONER_TEMPLATES_FILE: str({
    desc: 'Path to the YAML file describing the Docker runner templates this provisioner can start. Required. Each template lists its labels, image, cpu, memory, and max_concurrency.',
  }),
});
