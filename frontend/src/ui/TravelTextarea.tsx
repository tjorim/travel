import { Field } from "@base-ui/react/field";
import { forwardRef, type TextareaHTMLAttributes } from "react";

/** Base UI field behavior rendered as the browser's multiline text control. */
export const TravelTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TravelTextarea(props, ref) {
    return <Field.Control render={<textarea {...props} ref={ref} />} />;
  },
);
