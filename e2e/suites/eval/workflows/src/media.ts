/** The span processor uploads base64 data URIs found in a span's output as Langfuse media. */
export function base64DataUri({contentType, text}: {contentType: string; text: string}): string {
  return `data:${contentType};base64,${Buffer.from(text, 'utf8').toString('base64')}`;
}
