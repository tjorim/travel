import { m } from "../paraglide/messages.js";

/**
 * The choices for a visit's or stay's own date precision. The empty value follows the audience, which limits
 * its dates too; whichever of the two is coarser applies.
 */
export const recordPrecisionOptions = () => [
  <option key="follow" value="">
    {m.precision_record_follow()}
  </option>,
  <option key="day" value="day">
    {m.owner_full_dates()}
  </option>,
  <option key="month" value="month">
    {m.owner_months_only()}
  </option>,
  <option key="year" value="year">
    {m.owner_year_only()}
  </option>,
];
