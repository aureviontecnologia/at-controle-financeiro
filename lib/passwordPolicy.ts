export const PASSWORD_MIN_LENGTH = 12;

export type PasswordRequirement = {
  key: 'length' | 'lowercase' | 'uppercase' | 'number' | 'symbol';
  label: string;
  met: boolean;
};

export function passwordRequirements(password: string): PasswordRequirement[] {
  return [
    { key: 'length', label: `${PASSWORD_MIN_LENGTH} caracteres`, met: password.length >= PASSWORD_MIN_LENGTH },
    { key: 'lowercase', label: 'uma letra minúscula', met: /[a-z]/.test(password) },
    { key: 'uppercase', label: 'uma letra maiúscula', met: /[A-Z]/.test(password) },
    { key: 'number', label: 'um número', met: /\d/.test(password) },
    { key: 'symbol', label: 'um símbolo', met: /[^A-Za-z0-9\s]/.test(password) },
  ];
}

export function passwordPolicyError(password: string) {
  const missing = passwordRequirements(password).filter((item) => !item.met);
  if (!missing.length) return null;
  return `Use ${missing.map((item) => item.label).join(', ')}.`;
}
