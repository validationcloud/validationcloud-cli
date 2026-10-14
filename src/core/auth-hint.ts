export type AuthHintContext = {
  usesStaticToken: boolean;
};

export function loginHint(): string {
  return "run 'vcloud auth login'";
}

export function authHint(context: AuthHintContext): string {
  return context.usesStaticToken
    ? "fix or unset VC_TOKEN (stored credentials are used when it is unset)"
    : loginHint();
}
