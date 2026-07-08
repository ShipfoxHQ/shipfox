import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';

export function WebhookPublicEndpointAlert() {
  return (
    <Callout role="alert" type="default">
      <CalloutContent>
        <CalloutTitle>Public webhook endpoint</CalloutTitle>
        <CalloutDescription>
          Anyone with this URL can send webhook events to this source. You are responsible for
          verifying the received webhook in your workflow before trusting its payload.
        </CalloutDescription>
      </CalloutContent>
    </Callout>
  );
}
