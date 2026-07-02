import {Alert, AlertContent, AlertDescription, AlertTitle} from '@shipfox/react-ui';

export function WebhookPublicEndpointAlert() {
  return (
    <Alert variant="default" animated={false}>
      <AlertContent>
        <AlertTitle>Public webhook endpoint</AlertTitle>
        <AlertDescription>
          Anyone with this URL can send webhook events to this source. You are responsible for
          verifying the received webhook in your workflow before trusting its payload.
        </AlertDescription>
      </AlertContent>
    </Alert>
  );
}
