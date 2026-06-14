/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 */

import { type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { assertUnreachable } from 'twenty-shared/utils';

import { CustomException } from 'src/utils/custom-exception';

export enum VeridianCustomDomainExceptionCode {
  DOMAIN_ALREADY_TAKEN = 'DOMAIN_ALREADY_TAKEN',
  DOMAIN_ALREADY_REGISTERED_AS_PUBLIC_DOMAIN = 'DOMAIN_ALREADY_REGISTERED_AS_PUBLIC_DOMAIN',
  NO_CUSTOM_DOMAIN_SET = 'NO_CUSTOM_DOMAIN_SET',
}

const getUserFriendlyMessage = (code: VeridianCustomDomainExceptionCode) => {
  switch (code) {
    case VeridianCustomDomainExceptionCode.DOMAIN_ALREADY_TAKEN:
      return msg`This domain is already used by another workspace.`;
    case VeridianCustomDomainExceptionCode.DOMAIN_ALREADY_REGISTERED_AS_PUBLIC_DOMAIN:
      return msg`This domain is already registered as a public domain.`;
    case VeridianCustomDomainExceptionCode.NO_CUSTOM_DOMAIN_SET:
      return msg`No custom domain is set for this workspace.`;
    default:
      assertUnreachable(code);
  }
};

export class VeridianCustomDomainException extends CustomException<VeridianCustomDomainExceptionCode> {
  constructor(
    message: string,
    code: VeridianCustomDomainExceptionCode,
    { userFriendlyMessage }: { userFriendlyMessage?: MessageDescriptor } = {},
  ) {
    super(message, code, {
      userFriendlyMessage:
        userFriendlyMessage ?? getUserFriendlyMessage(code),
    });
  }
}
