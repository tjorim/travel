/** What a field validator can read of its form: the current value of any other field. */
export type FormContext = {
  fieldApi: { form: { getFieldValue: (name: never) => unknown } };
};
