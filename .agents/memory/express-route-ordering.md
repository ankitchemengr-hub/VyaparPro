---
name: Express route ordering
description: Literal path segments must come before param routes in the same router or Express matches the literal as the param value.
---

In Express, routes are matched in registration order. A literal path like `PATCH /products/bulk-price` registered AFTER `PATCH /products/:id` will never be reached — Express matches "bulk-price" as the `:id` value and the Zod/numeric validation rejects it with a 400 before the real handler runs.

**Why:** Express does first-match routing; it does not prefer literal segments over params.

**How to apply:** In any router file, always register all literal-sub-path routes (e.g. `/products/bulk-price`, `/products/groups`, `/products/brands`) before the param-wildcard route (`/products/:id`). Add a comment to the param route reminding future authors of this constraint.
