# CFHS-js

Complex file HTTP server.

Early WIP.

## Features

- Authentication: UUID tokens are used to manage accessing.
- Multi-instance: As many instances as you want.
- Multi-directory: The directories do not have to be located inside one place.

## Installation

This project is at the early stage. Simplified installation should be added later.

Now supporting GNU/Linux. BSD users might see problems.

## Configuration

### Overview

All config files are stored in `~/.config/cfhs-js`.
It may contain multiple directories; each of them represent one instance.
Each instance has 3 files:

- `conf`
- `dirs`
- `tokens`

### Config File: `conf`

This is where main configuration options reside.
Now only the port number is configurable.

Example:

```
Port=1453
ServerName=Example HTTP File Server
UrlPrefix=http://127.0.0.1:1453
```

This is not shell script, so no need to quote or escape for space characters.

You have to write port number in `UrlPrefix` again, unless it is the default
port of the protocol specified afore. While this program is supposed to listen
at a harmless port, users might need to visit through Nginx which listens at
80 or 443, according to your specific setup.

### Config File: `dirs`

Write a list of directories to be shared. Use absolute paths.

Example:

```
/tmp/cfhs-default:abcd
/tmp/cfhs-new
```

Optionally append `:abcd` at the end of a line to let it appear as `abcd` in the
root index.
In the example, the 2 directories will appear as `abcd` and `cfhs-new` in the
root index.

### Config File: `tokens`

Users should not touch this file. The program manages tokens.

This file is a CSV with 5 columns:

Index   | Field Name        | Details
------- | ----------------- | -------
0       | Timestamp         | Timestamp of generation.
1       | Type              | Single uppercase letter. A for admin; V for visitor.
2       | Token             | UUID with hyphen.
3       | Path              | The path which this token is authorized to access.
4       | Expiry            | The expiry date, ISO 8601 format, initial 19 characters.

## How Things Work

### Process Life Cycle

The program `cfhsctl` is a small script to manage configrations and processes.
It starts and ends `serverd.js` processes, which actually accepts HTTP requests.

Since this project is an early-stage WIP, you may prefer to use `serverd.js`
with manual configuration, instead of playing with `cfhsctl`.

### Tokens

Tokens include admin tokens and visitor tokens.
Admin tokens can be used to generate visitor tokens.

Admin tokens can access all directories and files,
but visitor tokens can only access the directories which they are authorized.

Both programs create tokens.

### Web User Session

When a user visits a page, the URL should include a token.
If the token is an admin token, or a visitor token with correct access at the path,
the user will be allowed to see the index of the directory or download the file.
When navigating from page to page, the token will be preserved in the URL.

## Copyright

Copyright (c) 2021 Neruthes.

Published under GNU GPLv2. See file `LICENSE`.
