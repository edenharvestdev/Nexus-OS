import "server-only";

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

function requireProvider(): CredentialSecretProvider {
  if (!configuredProvider) {
    throw new Error("Approved credential secret provider is not configured.");
  }
  return configuredProvider;
}

export async function protectCredential(value: string): Promise<string> {
  return requireProvider().protect(value);
}

export async function revealCredential(value: string): Promise<string> {
  return requireProvider().reveal(value);
}
