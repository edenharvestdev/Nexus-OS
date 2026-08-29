/** Server-side provider boundary. Never import this module into client components. */
export interface CredentialSecretProvider {
  protect(value: string): Promise<string>;
  reveal(value: string): Promise<string>;
}

let configuredProvider: CredentialSecretProvider | undefined;

/** Called only by trusted server bootstrap code after provider validation. */
export function configureCredentialSecretProvider(provider: CredentialSecretProvider): void {
  configuredProvider = provider;
}

function requireProvider(provider?: CredentialSecretProvider): CredentialSecretProvider {
  const selectedProvider = provider ?? configuredProvider;
  if (!selectedProvider) {
    throw new Error("Approved credential secret provider is not configured.");
  }
  return selectedProvider;
}

export async function protectCredential(
  value: string,
  provider?: CredentialSecretProvider,
): Promise<string> {
  return requireProvider(provider).protect(value);
}

export async function revealCredential(
  value: string,
  provider?: CredentialSecretProvider,
): Promise<string> {
  return requireProvider(provider).reveal(value);
}
