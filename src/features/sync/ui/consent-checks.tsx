"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { CheckRow } from "@/components/ui/check-row";
import { cn } from "@/lib/utils/cn";

import { LEGAL_URLS, LEGAL_VERSIONS } from "../legal";

/** Ссылка в тексте листа: тихая, но узнаваемая. */
const TEXT_LINK = cn(
  "text-ink-muted underline decoration-ink-faint underline-offset-2 transition-colors",
  "hover:text-ink hover:decoration-ink",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);

/** `2026-10-11` → `11.10.2026` */
export function редакция(версия: string): string {
  const [год, месяц, день] = версия.split("-");

  if (год === undefined || месяц === undefined || день === undefined) return версия;

  return `${день}.${месяц}.${год}`;
}

/**
 * Ссылка на документ в тексте отметки.
 *
 * Редакция — во всплывающей подсказке: в строке она была бы лишней водой, а
 * проверить, какую именно редакцию принимаешь, всё равно можно (и на самой
 * странице документа она названа в первой строке).
 */
export function LegalLink({
  href,
  version,
  children,
}: {
  href: string;
  version: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener"
      title={`Редакция от ${редакция(version)}`}
      className={cn(TEXT_LINK, "text-ink")}
    >
      {children}
    </Link>
  );
}

/**
 * Две отметки согласия — на регистрации и при повторном принятии.
 *
 * Две, а не одна. Согласие на обработку персональных данных оформляется
 * отдельно от иных документов, которые подтверждает человек (ч. 1 ст. 9
 * 152-ФЗ): в одну фразу с соглашением и политикой оно не входит, и отметка,
 * которой человек принимает условия сервиса, не должна в придачу отдавать
 * данные. Ни одна не стоит заранее; что обе поставлены, сервер получает
 * явными признаками в запросе (`consentPayload`) и пишет по строке на каждый
 * документ с хэшем текста.
 *
 * Ссылки открываются в новой вкладке: уйдя по ним в том же окне, человек
 * потерял бы набранное.
 */
export function ConsentChecks({
  termsAndPolicy,
  personalData,
  onTermsAndPolicy,
  onPersonalData,
}: {
  termsAndPolicy: boolean;
  personalData: boolean;
  onTermsAndPolicy: (checked: boolean) => void;
  onPersonalData: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <CheckRow checked={termsAndPolicy} onChange={onTermsAndPolicy}>
        Принимаю{" "}
        <LegalLink href={LEGAL_URLS.terms} version={LEGAL_VERSIONS.terms}>
          пользовательское соглашение
        </LegalLink>{" "}
        и{" "}
        <LegalLink href={LEGAL_URLS.policy} version={LEGAL_VERSIONS.policy}>
          политику конфиденциальности
        </LegalLink>
      </CheckRow>
      <CheckRow checked={personalData} onChange={onPersonalData}>
        Даю{" "}
        <LegalLink href={LEGAL_URLS.consent} version={LEGAL_VERSIONS.consent}>
          согласие на обработку персональных данных
        </LegalLink>
      </CheckRow>
    </div>
  );
}
