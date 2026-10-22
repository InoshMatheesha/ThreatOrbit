import { model, Schema } from 'mongoose';

/**
 * Settings an administrator changes from the app, kept in the database so they
 * survive redeploys without touching environment variables.
 */
export interface SettingDoc {
  _id: string;
  value: Record<string, unknown>;
  updatedAt: Date;
  updatedBy?: { id: string; name: string };
}

const settingSchema = new Schema<SettingDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, required: true },
    updatedBy: { _id: false, id: String, name: String },
  },
  { versionKey: false },
);

export const Setting = model<SettingDoc>('Setting', settingSchema);
