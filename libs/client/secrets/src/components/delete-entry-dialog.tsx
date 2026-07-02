import {
  Alert,
  Button,
  Code,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@shipfox/react-ui';

export type StoreEntryKind = 'secret' | 'variable';

function referenceExpression(kind: StoreEntryKind, key: string): string {
  // Built by concatenation, not a template literal, because `${{` cannot appear
  // inside a JS template string.
  return kind === 'secret' ? `\${{ secrets.${key} }}` : `\${{ vars.${key} }}`;
}

export function DeleteEntryDialog({
  open,
  onOpenChange,
  entryKey,
  kind,
  isLoading,
  errorMessage,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  entryKey: string;
  kind: StoreEntryKind;
  isLoading: boolean;
  errorMessage?: string | undefined;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Delete {kind}</ModalTitle>
        </ModalHeader>
        <ModalBody className="gap-16">
          <Text size="sm">
            Delete{' '}
            <Code as="span" variant="label">
              {entryKey}
            </Code>
            ? Workflows that reference{' '}
            <Code as="span" variant="label">
              {referenceExpression(kind, entryKey)}
            </Code>{' '}
            will fail at their next run.
          </Text>
          {errorMessage ? (
            <Alert variant="error" animated={false}>
              <Text size="sm">{errorMessage}</Text>
            </Alert>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" isLoading={isLoading} onClick={onConfirm}>
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
