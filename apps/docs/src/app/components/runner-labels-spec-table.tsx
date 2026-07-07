interface RunnerLabelsSpecTableProps {
  configs: Array<{cpu: number; ram: number; diskSize: number}>;
  range: 'standard' | 'performance';
  os: string;
  osVersion: string;
  suffix?: string;
}

export function RunnerLabelsSpecTable({
  configs,
  range,
  os,
  osVersion,
  suffix,
}: RunnerLabelsSpecTableProps) {
  return (
    <table>
      <thead>
        <tr>
          <th>Label</th>
          <th>CPU</th>
          <th>Memory</th>
          <th>Disk</th>
        </tr>
      </thead>
      <tbody>
        {configs.map(({cpu, ram, diskSize}) => (
          <tr key={`${cpu}-${ram}`}>
            <td>
              <code>{`shipfox-${range}-${cpu}cpu-${os}-${osVersion}${suffix ? `-${suffix}` : ''}`}</code>
            </td>
            <td>{cpu}</td>
            <td>{ram} GB</td>
            <td>{diskSize} GB</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
