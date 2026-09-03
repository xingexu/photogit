# Security policy

PhotoGit is not yet production-ready. Do not use it as the only copy of valuable artwork.

Report vulnerabilities privately to the project maintainer rather than opening a public issue. Until a dedicated security address is configured, use GitHub private vulnerability reporting on the repository.

The helper binds only to loopback, authenticates each request, restricts operations to explicitly approved roots, validates identifiers, limits request sizes, and avoids shell interpolation. Credentials belong in the operating-system credential manager or an existing Git credential helper and must never be written to a PhotoGit project.
