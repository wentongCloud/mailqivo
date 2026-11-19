import { ChannelBody, ChannelConfig, EmailInput, type ChannelDto } from "@mailqivo/shared";
import { z } from "zod";

const mailbox = z.string().trim().refine((value) => EmailInput.safeParse(value).success, {
  message: "邮箱格式不正确"
});

const channelName = (account: string) => account.slice(0, 100);
const senderName = (account: string) => account.split("@")[0]!.slice(0, 200);

export function channelFormSchema(item: ChannelDto | null) {
  // Older channels may authenticate with a username and send from a separate address.
  const previousAccount = item?.smtp.user ?? "";
  const separateSender = item && previousAccount.toLowerCase() !== item.from_email.toLowerCase();
  return z.object({
    ...ChannelBody.shape,
    name: z.string(),
    from_email: z.string(),
    from_name: z.string(),
    reply_to: z.string(),
    smtp: separateSender ? ChannelConfig.shape.smtp : ChannelConfig.shape.smtp.extend({ user: mailbox }),
    imap: ChannelConfig.shape.imap.extend({ user: mailbox.or(z.literal("")) })
  }).transform((values): z.input<typeof ChannelBody> => {
    const sender = separateSender ? item.from_email : values.smtp.user;
    const previousSender = separateSender ? item.from_email : previousAccount;
    const keepReply = item && !item.imap.user && item.reply_to !== item.from_email;
    return {
      ...values,
      name: item && item.name !== channelName(previousSender) ? item.name : channelName(sender),
      from_name: item && item.from_name !== senderName(previousSender) ? item.from_name : senderName(sender),
      from_email: sender,
      reply_to: values.imap.user || (keepReply ? item.reply_to : sender)
    };
  }).pipe(ChannelBody);
}
