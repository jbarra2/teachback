// Client-side checks for the auth forms. The server (Better Auth, T06) checks again; these only
// give fast, friendly feedback.

export const PASSWORD_MIN = 8;
/** Better Auth's default maximum. */
export const PASSWORD_MAX = 128;
export const NAME_MAX = 100;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

// Something@something.tld, no spaces. Deliberately loose: the real check is the confirmation email.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(email: string): string | undefined {
  const value = email.trim();
  if (!value) return "Enter your email address.";
  if (!EMAIL.test(value))
    return "Enter a valid email address, like name@example.com.";
  return undefined;
}

export function passwordError(password: string): string | undefined {
  if (!password) return "Enter your password.";
  if (password.length < PASSWORD_MIN)
    return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX)
    return `Use at most ${PASSWORD_MAX} characters.`;
  return undefined;
}

export function nameError(name: string): string | undefined {
  const value = name.trim();
  if (!value) return "Enter your name.";
  if (value.length > NAME_MAX) return `Use at most ${NAME_MAX} characters.`;
  return undefined;
}

export type LoginValues = {
  email: string;
  password: string;
};

export type SignupValues = LoginValues & {
  name: string;
};

export function validateLogin(
  values: LoginValues,
): FieldErrors<keyof LoginValues> {
  return dropEmpty({
    email: emailError(values.email),
    password: passwordError(values.password),
  });
}

export function validateSignup(
  values: SignupValues,
): FieldErrors<keyof SignupValues> {
  return dropEmpty({
    name: nameError(values.name),
    email: emailError(values.email),
    password: passwordError(values.password),
  });
}

function dropEmpty<K extends string>(
  errors: Record<K, string | undefined>,
): FieldErrors<K> {
  const result: FieldErrors<K> = {};
  for (const key of Object.keys(errors) as K[]) {
    if (errors[key]) result[key] = errors[key];
  }
  return result;
}
