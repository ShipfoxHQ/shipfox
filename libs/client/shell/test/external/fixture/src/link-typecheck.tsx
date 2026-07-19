import {Link, useParams} from '@tanstack/react-router';

export function ExternalSettingsLink() {
  const params = useParams({from: '/workspaces/$wid/settings/external'});
  return (
    <Link to="/workspaces/$wid/settings/external" params={{wid: params.wid}}>
      External settings
    </Link>
  );
}
