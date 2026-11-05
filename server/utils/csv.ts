export function toCsv(rows: (string | number)[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const safe =
              typeof value === "string" && /^[=+@\-\t\r]/.test(value)
                ? "'" + value
                : String(value);
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
