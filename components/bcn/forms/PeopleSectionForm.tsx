"use client";

import { Field, TextAreaField } from "@/components/bcn/atoms/Field";
import { FGrid, Panel } from "@/components/bcn/forms/Panel";
import {
  PEOPLE_PRIMARY_FIELDS,
  type PeopleSectionPayload,
} from "@/lib/bcn/section-payloads";

type Props = {
  value: PeopleSectionPayload;
  onChange: (next: PeopleSectionPayload) => void;
  onBlur: () => void;
  disabled?: boolean;
};

function ContactRow({
  index,
  row,
  onChange,
  onBlur,
  disabled,
}: {
  index: number;
  row: PeopleSectionPayload["firstCallTeam"][number];
  onChange: (next: PeopleSectionPayload["firstCallTeam"][number]) => void;
  onBlur: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="contact-row">
      <span className="contact-no">
        <small>Contact</small>
        <b>{index + 1}</b>
      </span>
      <div className="cr-fields">
        <FGrid>
          <Field
            label="Name"
            value={row.name}
            placeholder={index === 2 ? "Add a third contact" : ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...row, name: e.target.value })}
            onBlur={onBlur}
          />
          <Field
            label="Relationship"
            value={row.relationship}
            disabled={disabled}
            onChange={(e) => onChange({ ...row, relationship: e.target.value })}
            onBlur={onBlur}
          />
          <Field
            label="Phone"
            value={row.phone}
            disabled={disabled}
            onChange={(e) => onChange({ ...row, phone: e.target.value })}
            onBlur={onBlur}
          />
          <Field
            label="Email"
            value={row.email}
            disabled={disabled}
            onChange={(e) => onChange({ ...row, email: e.target.value })}
            onBlur={onBlur}
          />
        </FGrid>
      </div>
    </div>
  );
}

function RoleBlockRow({
  block,
  onChange,
  onBlur,
  disabled,
}: {
  block: PeopleSectionPayload["additionalContacts"][number];
  onChange: (next: PeopleSectionPayload["additionalContacts"][number]) => void;
  onBlur: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="contact-row">
      <div className="cr-fields">
        <div className="advlabel">{block.label}</div>
        <FGrid>
          {PEOPLE_PRIMARY_FIELDS.map((key) => (
            <Field
              key={key}
              label={key}
              value={block.fields[key] ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...block,
                  fields: { ...block.fields, [key]: e.target.value },
                })
              }
              onBlur={onBlur}
            />
          ))}
        </FGrid>
      </div>
    </div>
  );
}

export function PeopleSectionForm({ value, onChange, onBlur, disabled }: Props) {
  return (
    <>
      <Panel title="Primary Family Contact" icon="person">
        <FGrid>
          {PEOPLE_PRIMARY_FIELDS.map((key) => (
            <Field
              key={key}
              label={key}
              value={value.primaryContact[key] ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...value,
                  primaryContact: {
                    ...value.primaryContact,
                    [key]: e.target.value,
                  },
                })
              }
              onBlur={onBlur}
            />
          ))}
        </FGrid>
      </Panel>

      <Panel title="First Call Team" icon="people">
        {value.firstCallTeam.map((row, index) => (
          <ContactRow
            key={index}
            index={index}
            row={row}
            disabled={disabled}
            onBlur={onBlur}
            onChange={(next) => {
              const firstCallTeam = [...value.firstCallTeam];
              firstCallTeam[index] = next;
              onChange({ ...value, firstCallTeam });
            }}
          />
        ))}
      </Panel>

      <Panel title="Additional Family & Personal Contacts" icon="people">
        {value.additionalContacts.map((block, index) => (
          <RoleBlockRow
            key={block.label}
            block={block}
            disabled={disabled}
            onBlur={onBlur}
            onChange={(next) => {
              const additionalContacts = [...value.additionalContacts];
              additionalContacts[index] = next;
              onChange({ ...value, additionalContacts });
            }}
          />
        ))}
      </Panel>

      <Panel>
        <TextAreaField
          label="Additional Notes"
          rows={3}
          value={value.notes}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          onBlur={onBlur}
        />
      </Panel>
    </>
  );
}
