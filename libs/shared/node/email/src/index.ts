export {EmailTemplateError} from './errors.js';
export {
  createEmailRenderer,
  type EmailRenderer,
  type EmailRendererOptions,
  type EmailTemplateDefinition,
} from './renderer.js';
export {type RenderedEmail, renderEmail} from './template.js';
export type {
  ResetPasswordData,
  TemplateName,
  TemplateVariables,
  VerifyEmailData,
  WorkspaceInvitationData,
} from './text.js';
