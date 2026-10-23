import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const bn: Record<string, string> = {
  'Delete center': 'কোচিং সেন্টার মুছুন',
  'Center ID': 'সেন্টারের আইডি',
  'This coaching center is unavailable.': 'এই কোচিং সেন্টারটি পাওয়া যাচ্ছে না।',
  'Type the exact coaching center name to confirm deletion.':
    'মুছে ফেলা নিশ্চিত করতে কোচিং সেন্টারের সঠিক নাম লিখুন।',
  'The coaching center changed. Reopen the deletion dialog and try again.':
    'কোচিং সেন্টারের তথ্য বদলেছে। মুছে ফেলার ডায়ালগ আবার খুলে চেষ্টা করুন।',
  'Suspend the center and wait for in-flight SMS submissions to finish before deleting it.':
    'মুছে ফেলার আগে সেন্টারটি স্থগিত করুন এবং চলমান এসএমএস জমা দেওয়া শেষ হওয়া পর্যন্ত অপেক্ষা করুন।',
  'Delete permanently': 'স্থায়ীভাবে মুছুন',
  'Type the coaching center name to confirm': 'নিশ্চিত করতে কোচিং সেন্টারের নাম লিখুন',
  'Suspend this coaching center before deleting it.': 'মুছে ফেলার আগে কোচিং সেন্টারটি স্থগিত করুন।',
  'Permanently delete this coaching center and all its students, results, messages, staff access and SMS settings? This cannot be undone. User accounts and other coaching centers are kept. SMS already sent cannot be recalled.':
    'এই কোচিং সেন্টার এবং এর সব শিক্ষার্থী, ফলাফল, বার্তা, কর্মীদের প্রবেশাধিকার ও এসএমএস সেটিংস স্থায়ীভাবে মুছে ফেলবেন? এটি ফেরানো যাবে না। ব্যবহারকারীর অ্যাকাউন্ট ও অন্য কোচিং সেন্টার রাখা হবে। পাঠানো এসএমএস ফেরানো যাবে না।',
  'Download recovery codes': 'রিকভারি কোড ডাউনলোড করুন',
  'Review the personalized messages below before sending.':
    'পাঠানোর আগে নিচের ব্যক্তিগত বার্তাগুলো যাচাই করুন।',
  'Send timing': 'পাঠানোর সময়',
  Schedule: 'সময় নির্ধারণ',
  'Send date and time': 'পাঠানোর তারিখ ও সময়',
  'Timezone:': 'সময় অঞ্চল:',
  'Schedule messages': 'বার্তা পাঠানোর সময় নির্ধারণ করুন',
  'Send messages': 'বার্তা পাঠান',
  'SMS details': 'এসএমএসের বিস্তারিত',
  'SMS acceptance is not proof of delivery. Segment counts are estimates; the provider determines final charges.':
    'এসএমএস গৃহীত হওয়া পৌঁছানোর প্রমাণ নয়। সেগমেন্ট সংখ্যা আনুমানিক; চূড়ান্ত খরচ সেবাদাতা নির্ধারণ করেন।',
  'This record changed elsewhere. Your edits are kept. Discard changes or reopen the editor to load the latest saved values.':
    'অন্য কেউ এই তথ্য পরিবর্তন করেছেন। আপনার লেখা রাখা হয়েছে। সর্বশেষ সংরক্ষিত তথ্য দেখতে পরিবর্তন বাতিল করুন বা এডিটর আবার খুলুন।',
  'Sign out and discard unsaved changes?': 'সংরক্ষণ না করা পরিবর্তন বাতিল করে সাইন আউট করবেন?',
  'Unsaved changes will be discarded.': 'সংরক্ষণ না করা পরিবর্তন বাতিল হবে।',
  'Updating…': 'হালনাগাদ হচ্ছে…',
  'Showing saved data. Reconnect or try again to update.':
    'সংরক্ষিত তথ্য দেখানো হচ্ছে। হালনাগাদ করতে ইন্টারনেটে যুক্ত হন বা আবার চেষ্টা করুন।',
  'You are offline. Reconnect to load this screen.':
    'আপনি অফলাইনে আছেন। এই পৃষ্ঠা খুলতে ইন্টারনেটে যুক্ত হন।',
  'Connection interrupted. Reconnecting will refresh this screen.':
    'সংযোগ বিচ্ছিন্ন হয়েছে। সংযোগ ফিরলে তথ্য হালনাগাদ হবে।',
  'Confirmation was not received. Check the latest records before trying again; your change may already have been saved.':
    'নিশ্চিতকরণ পাওয়া যায়নি। আবার চেষ্টা করার আগে সর্বশেষ তথ্য দেখুন; আপনার পরিবর্তন ইতিমধ্যে সংরক্ষিত হয়ে থাকতে পারে।',
  'This request could not finish. Please try again.': 'কাজটি শেষ করা যায়নি। আবার চেষ্টা করুন।',
  'Discard unsaved changes?': 'সংরক্ষণ না করা পরিবর্তন বাতিল করবেন?',
  'Discard changes': 'পরিবর্তন বাতিল করুন',
  'Save or discard your marks before switching groups.':
    'গ্রুপ বদলানোর আগে নম্বর সংরক্ষণ করুন বা পরিবর্তন বাতিল করুন।',
  'Could not update choices. Try again.': 'তালিকা হালনাগাদ করা যায়নি। আবার চেষ্টা করুন।',
  'No matches in loaded choices. Load more to continue searching.':
    'লোড হওয়া তালিকায় মিল নেই। খোঁজা চালিয়ে যেতে আরও লোড করুন।',
  Choices: 'বিকল্পসমূহ',
  'Cancel sending': 'পাঠানো বাতিল করুন',
  'Stop unsent messages? Already submitted messages cannot be recalled.':
    'বাকি বার্তা পাঠানো বন্ধ করবেন? ইতিমধ্যে পাঠানো বার্তা ফেরত নেওয়া যাবে না।',
  Appearance: 'থিম',
  'Switch to light mode': 'হালকা থিম চালু করুন',
  'Switch to dark mode': 'ডার্ক থিম চালু করুন',
  Light: 'হালকা',
  Dark: 'ডার্ক',
  System: 'ডিভাইস অনুযায়ী',
  'Current class': 'বর্তমান শ্রেণি',
  'Current session': 'বর্তমান সেশন',
  Skipped: 'বাদ দেওয়া হয়েছে',
  'No identifier': 'পরিচিতি নম্বর নেই',
  'Please sign in to continue.': 'চালিয়ে যেতে সাইন ইন করুন।',
  'Your role does not allow this action. Ask your center admin.':
    'আপনার এই কাজের অনুমতি নেই। সেন্টারের অ্যাডমিনের সঙ্গে যোগাযোগ করুন।',
  'Only your center admin can do this.': 'শুধু সেন্টারের অ্যাডমিন এই কাজ করতে পারবেন।',
  'The phone number or password is incorrect.': 'ফোন নম্বর বা পাসওয়ার্ড সঠিক নয়।',
  'Too many attempts. Please wait before trying again.':
    'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
  'Your current password is incorrect.': 'বর্তমান পাসওয়ার্ড সঠিক নয়।',
  'Refresh or recharge your SMS balance before sending.':
    'পাঠানোর আগে এসএমএস ব্যালেন্স হালনাগাদ বা রিচার্জ করুন।',
  'The provider reported insufficient balance.': 'এসএমএস কোম্পানি জানিয়েছে ব্যালেন্স যথেষ্ট নয়।',
  'Insufficient SMS balance.': 'এসএমএস ব্যালেন্স যথেষ্ট নয়।',
  'Source data changed. Prepare a fresh preview before sending.':
    'মূল তথ্য বদলেছে। পাঠানোর আগে নতুন নমুনা তৈরি করুন।',
  'This record changed or is unavailable. Reload it before saving again.':
    'এই তথ্য বদলেছে বা পাওয়া যাচ্ছে না। আবার খুলে তারপর সংরক্ষণ করুন।',
  'Another teacher saved these marks. Reload before making changes.':
    'অন্য শিক্ষক নম্বর সংরক্ষণ করেছেন। আবার খুলে তারপর পরিবর্তন করুন।',
  'The maximum cannot be lower than an existing score.':
    'সর্বোচ্চ নম্বর আগে লেখা কোনো প্রাপ্ত নম্বরের চেয়ে কম হতে পারবে না।',
  'Enter a valid Bangladesh mobile number': 'বাংলাদেশের সঠিক মোবাইল নম্বর লিখুন',
  'Number blocked': 'নম্বর বন্ধ করা আছে',
  'Block number': 'নম্বর বন্ধ করুন',
  'Unblock number': 'নম্বর আবার চালু করুন',
  'SMS permitted': 'এসএমএসের অনুমতি আছে',
  'No SMS permission': 'এসএমএসের অনুমতি নেই',
  'Blocking this number stops SMS for every student sharing it in this center. Unblocking does not override each student’s contact permission.':
    'এই নম্বর বন্ধ করলে এই সেন্টারে একই নম্বর ব্যবহার করা সব শিক্ষার্থীর এসএমএস বন্ধ হবে। আবার চালু করলেও প্রতিটি শিক্ষার্থীর আলাদা অনুমতি লাগবে।',
  'LEARNING, IN FOCUS': 'শেখার অগ্রগতি এক নজরে',
  'Set the exam once. Keep every result in its place.':
    'পরীক্ষা তৈরি করুন একবার। সব ফলাফল রাখুন একসঙ্গে।',
  None: 'কোনোটিই নয়',
  subjects: 'বিষয়',
  'Add a batch once. Later group changes will not alter this exam’s participants.':
    'একবার ব্যাচ যোগ করুন। পরে ব্যাচের সদস্য বদলালেও এই পরীক্ষার অংশগ্রহণকারী বদলাবে না।',
  'Participants added. Existing participants were not duplicated.':
    'অংশগ্রহণকারী যোগ হয়েছে। আগে থেকে থাকা কাউকে আবার যোগ করা হয়নি।',
  'Exam series': 'পরীক্ষার সিরিজ',
  'Result status for': 'ফলাফলের অবস্থা:',
  'Marks for': 'প্রাপ্ত নম্বর:',
  'No participants': 'কোনো অংশগ্রহণকারী নেই',
  'Add students from a group on the exam page first.':
    'আগে পরীক্ষার পৃষ্ঠা থেকে ব্যাচের শিক্ষার্থীদের যোগ করুন।',
  'MAKE IT YOURS': 'আপনার মতো করে সাজান',
  'Uncheck to archive.': 'আর্কাইভ করতে টিক তুলে দিন।',
  'No students in this group yet. Add group memberships from each student’s profile.':
    'এই ব্যাচে এখনো শিক্ষার্থী নেই। শিক্ষার্থীর প্রোফাইল থেকে ব্যাচ যোগ করুন।',
  'WRITE ONCE. MAKE IT PERSONAL.': 'লিখুন একবার। প্রত্যেকের জন্য আলাদা বার্তা।',
  'Keep your voice consistent. Let the student details change.':
    'আপনার ভাষা থাকুক একই। শিক্ষার্থীর তথ্য বদলাবে নিজে থেকেই।',
  'Only your center admin can manage staff and roles.':
    'শুধু সেন্টারের অ্যাডমিন স্টাফ ও ভূমিকা পরিচালনা করতে পারবেন।',
  'CLEAR ROLES. SHARED PROGRESS.': 'স্পষ্ট দায়িত্ব। একসঙ্গে এগিয়ে চলা।',
  Admin: 'অ্যাডমিন',
  'allowed actions': 'টি কাজের অনুমতি',
  'Create a role, then assign it to staff. Staff have no access until permissions are granted.':
    'ভূমিকা তৈরি করে স্টাফকে দিন। অনুমতি না দেওয়া পর্যন্ত স্টাফ কোনো তথ্য দেখতে পারবেন না।',
  'The selected staff member becomes the only center admin. Your access will depend on your assigned staff roles.':
    'নির্বাচিত স্টাফই সেন্টারের একমাত্র অ্যাডমিন হবেন। এরপর আপনার প্রবেশাধিকার নির্ভর করবে আপনার স্টাফ ভূমিকার ওপর।',
  'Choose an active staff member': 'সক্রিয় স্টাফ নির্বাচন করুন',
  'Sending & sensitive actions': 'বার্তা পাঠানো ও গুরুত্বপূর্ণ কাজ',
  'Share this private, one-use link directly with the intended person. It expires in 24 hours. Existing users must sign in to accept.':
    'এই গোপন, একবার ব্যবহারযোগ্য লিংক সরাসরি নির্দিষ্ট ব্যক্তিকে দিন। মেয়াদ ২৪ ঘণ্টা। আগের ব্যবহারকারীকে সাইন ইন করে গ্রহণ করতে হবে।',
  'YOUR WORKSPACE, YOUR WAY': 'আপনার কর্মক্ষেত্র, আপনার মতো',
  Language: 'ভাষা',
  'SMS account': 'এসএমএস অ্যাকাউন্ট',
  'Sender IDs:': 'প্রেরক আইডি:',
  'Replace account settings': 'এসএমএস অ্যাকাউন্টের সেটিংস বদলান',
  'Comma-separated approved IDs from your provider.':
    'এসএমএস কোম্পানির অনুমোদিত আইডিগুলো কমা দিয়ে আলাদা করে লিখুন।',
  'Messages per provider request': 'এক অনুরোধে বার্তার সংখ্যা',
  'Keep 1 until your provider confirms larger batch limits.':
    'এসএমএস কোম্পানি বড় ব্যাচের সীমা নিশ্চিত না করা পর্যন্ত ১ রাখুন।',
  'Seconds between batches': 'দুই ব্যাচের মাঝে বিরতি (সেকেন্ড)',
  'Replacing credentials pauses affected unsent campaigns. Old credentials are retained only to check previously submitted messages. API keys are stored in the database as requested; database exports must be protected.':
    'অ্যাকাউন্ট বদলালে সংশ্লিষ্ট অবশিষ্ট বার্তা পাঠানো বন্ধ হবে। পুরোনো কী আগের বার্তার অবস্থা যাচাইয়ের জন্য রাখা হয়। আপনার অনুরোধ অনুযায়ী কী ডেটাবেসে রাখা হয়েছে; ডেটাবেসের কপি নিরাপদ রাখুন।',
  'EVERY UPDATE, ACCOUNTED FOR': 'প্রতিটি বার্তার হিসাব',
  'A clear history of what was prepared, submitted, and delivered.':
    'কোন বার্তা প্রস্তুত, জমা ও পৌঁছেছে তার স্পষ্ট ইতিহাস।',
  'messages ·': 'বার্তা ·',
  delivered: 'পৌঁছেছে',
  'No messages yet': 'এখনো কোনো বার্তা নেই',
  'Prepare a result update or an announcement to get started.':
    'ফলাফল বা নোটিশের বার্তা তৈরি করে শুরু করুন।',
  'PERSONAL, WITHOUT THE REPETITION': 'বারবার না লিখেই ব্যক্তিগত বার্তা',
  'Choose the audience. Write once. Review every personalized message.':
    'প্রাপক নির্বাচন করুন। একবার লিখুন। প্রত্যেকের বার্তা যাচাই করুন।',
  'Choose your update': 'বার্তার ধরন বেছে নিন',
  'Only the selected student’s eligible contacts will be included.':
    'শুধু নির্বাচিত শিক্ষার্থীর অনুমোদিত নম্বরগুলো যুক্ত হবে।',
  'Leave empty to include all eligible students.':
    'সব শিক্ষার্থী রাখতে ফাঁকা রাখুন, বা নির্দিষ্ট ব্যাচ বেছে নিন।',
  'Active permitted contacts only. Pending marks excluded, duplicates auto-merged.':
    'শুধুমাত্র সক্রিয় ও অনুমোদিত যোগাযোগ। অসম্পূর্ণ ফলাফল বাদ এবং ডুপ্লিকেট সমন্বয় করা হবে।',
  'Write a message or choose a saved template': 'বার্তা লিখুন বা সংরক্ষিত টেমপ্লেট বেছে নিন',
  'MESSAGE PREVIEW': 'বার্তার নমুনা',
  'Your message takes shape here. Real student previews appear in the next step.':
    'এখানে বার্তার নমুনা দেখুন। পরের ধাপে আসল শিক্ষার্থীর তথ্যসহ বার্তা দেখাবে।',
  'Review first. Send now or choose a time. Your phone does not need to stay open.':
    'আগে যাচাই করুন। এখনই পাঠান বা সময় ঠিক করুন। ফোন খোলা রাখার দরকার নেই।',
  'personalized messages prepared so far. You can leave this page.':
    'টি ব্যক্তিগত বার্তা এ পর্যন্ত প্রস্তুত হয়েছে। চাইলে অন্য পৃষ্ঠায় যেতে পারেন।',
  'Scheduled:': 'নির্ধারিত সময়:',
  'View excluded students (': 'বাদ পড়া শিক্ষার্থী দেখুন (',
  'FINAL CHECK': 'শেষবার যাচাই',
  'Check the actual messages below. SMS acceptance is not proof of delivery. Segment counts are estimates; the provider determines final charges.':
    'নিচে আসল বার্তাগুলো যাচাই করুন। জমা নেওয়া মানেই পৌঁছানো নয়। এসএমএস অংশের সংখ্যা আনুমানিক; চূড়ান্ত খরচ এসএমএস কোম্পানি নির্ধারণ করে।',
  'Refresh unsent messages': 'না পাঠানো বার্তা নতুন তথ্য দিয়ে তৈরি করুন',
  'Personalized messages': 'ব্যক্তিগত বার্তাগুলো',
  'estimated segments': 'আনুমানিক এসএমএস অংশ',
  'Select for a new resend campaign': 'আবার পাঠানোর নতুন তালিকায় যোগ করুন',
  'No eligible messages. Check contacts, permission to send, and pending marks.':
    'পাঠানোর উপযুক্ত বার্তা নেই। নম্বর, পাঠানোর অনুমতি ও অসম্পূর্ণ নম্বর পরীক্ষা করুন।',
  'Your role does not allow viewing message content.':
    'আপনার ভূমিকায় বার্তার লেখা দেখার অনুমতি নেই।',
  'Review resend (': 'আবার পাঠানোর তালিকা দেখুন (',
  'PLATFORM OWNER': 'প্ল্যাটফর্মের মালিক',
  'Provision independent workspaces. Center data stays inside each center.':
    'আলাদা সেন্টার তৈরি করুন। প্রতিটি সেন্টারের তথ্য আলাদা থাকবে।',
  'Create your first coaching center': 'প্রথম কোচিং সেন্টার তৈরি করুন',
  'Its admin receives a one-use account setup link.':
    'অ্যাডমিন অ্যাকাউন্ট চালুর একবার ব্যবহারযোগ্য লিংক পাবেন।',
  'Platform-assisted recovery': 'প্ল্যাটফর্মের সহায়তায় অ্যাকাউন্ট উদ্ধার',
  'Verify identity through established onboarding records first. Center-admin status alone does not prove ownership of a personal account.':
    'আগের নিবন্ধনের তথ্য দিয়ে আগে পরিচয় যাচাই করুন। শুধু সেন্টারের অ্যাডমিন হওয়া ব্যক্তিগত অ্যাকাউন্টের মালিকানার প্রমাণ নয়।',
  'Verification reference': 'পরিচয় যাচাইয়ের রেফারেন্স',
  'Record a support reference, not sensitive documents.': 'সহায়তার রেফারেন্স লিখুন, গোপন নথি নয়।',
  'I independently verified this person’s account ownership.':
    'আমি আলাদাভাবে এই ব্যক্তির অ্যাকাউন্টের মালিকানা যাচাই করেছি।',
  'Issue one-use recovery code': 'একবার ব্যবহারযোগ্য উদ্ধার কোড দিন',
  'Share privately with the verified person. This is shown only in this session.':
    'যাচাইকৃত ব্যক্তিকে গোপনে দিন। শুধু এই সেশনেই কোডটি দেখা যাবে।',
  'Hide code': 'কোড লুকান',
  'YOUR PERSONAL ACCOUNT': 'আপনার ব্যক্তিগত অ্যাকাউন্ট',
  'Changing your password or recovery codes signs out other sessions. Center admins cannot access your recovery codes.':
    'পাসওয়ার্ড বা রিকভারি কোড বদলালে অন্য সব সেশন বন্ধ হবে। সেন্টারের অ্যাডমিন আপনার রিকভারি কোড দেখতে পারবেন না।',
  'Leave blank to regenerate recovery codes only.': 'শুধু নতুন রিকভারি কোড তৈরি করতে ফাঁকা রাখুন।',
  'YOUR COMMUNITY': 'আপনার শিক্ষার্থীরা',
  'One student record. Every exam. Every update.': 'শিক্ষার্থীর এক প্রোফাইলে সব পরীক্ষা ও বার্তা।',
  groups: 'ব্যাচ',
  'Add a contact with permission before sending results.':
    'ফলাফল পাঠানোর আগে অনুমতিপ্রাপ্ত একটি নম্বর যোগ করুন।',
  'Archive student': 'শিক্ষার্থী আর্কাইভ করুন',
  '? Existing exam results and sent messages stay in history. New messages will exclude this student.':
    '? আগের ফলাফল ও পাঠানো বার্তা ইতিহাসে থাকবে। নতুন বার্তায় এই শিক্ষার্থী বাদ যাবে।',
  'Sign out? Unsaved changes on this page will be lost.':
    'সাইন আউট করবেন? এই পৃষ্ঠার সংরক্ষণ না করা পরিবর্তন হারিয়ে যাবে।',
  'No coaching center available': 'কোনো কোচিং সেন্টার পাওয়া যায়নি',
  'Ask your center admin for an invitation or contact the platform owner.':
    'সেন্টারের অ্যাডমিনের কাছে আমন্ত্রণ চান বা প্ল্যাটফর্মের মালিকের সঙ্গে যোগাযোগ করুন।',
  WORKSPACE: 'কর্মক্ষেত্র',
  MANAGE: 'পরিচালনা',
  'Switch coaching center? Unsaved changes on this page will be lost.':
    'কোচিং সেন্টার বদলাবেন? এই পৃষ্ঠার সংরক্ষণ না করা পরিবর্তন হারিয়ে যাবে।',
  '— reconnect before saving or sending.': '— সংরক্ষণ বা পাঠানোর আগে ইন্টারনেটে যুক্ত হোন।',
  'Page not found': 'পৃষ্ঠাটি পাওয়া যায়নি',
  'Choose a page from the navigation to continue.': 'মেনু থেকে একটি পৃষ্ঠা বেছে নিন।',
  'Made for more meaningful updates.': 'প্রতিটি আপডেট হোক অর্থবহ।',
  'YOUR NEXT STEP': 'আপনার পরের ধাপ',
  'Good teaching deserves': 'ভালো শিক্ষাদানের সঙ্গী হোক',
  'a simpler workspace.': 'সহজ একটি কর্মক্ষেত্র।',
  'Personal. Clear. Connected.': 'ব্যক্তিগত। স্পষ্ট। সংযুক্ত।',
  'Active in your center': 'আপনার সেন্টারে সক্রিয়',
  'A clear view of your latest updates.': 'সাম্প্রতিক বার্তাগুলো এক নজরে।',
  messages: 'বার্তা',
  'Your first result update will appear here.': 'আপনার প্রথম ফলাফলের বার্তা এখানে দেখা যাবে।',
  'Keep these somewhere private. Each code works once. They will not be shown again.':
    'কোডগুলো গোপন স্থানে রাখুন। প্রতিটি একবার কাজ করবে। পরে আর দেখানো হবে না।',
  'LESS ADMIN. MORE TEACHING.': 'কাজের ঝামেলা কমুক। পড়ানোর সময় বাড়ুক।',
  'Your next result.': 'আপনার পরের ফলাফল।',
  'Their next milestone.': 'তাদের পরের অর্জন।',
  'Bring your students, results, and family updates together. Thoughtfully simple. Always personal.':
    'শিক্ষার্থী, ফলাফল ও অভিভাবকদের বার্তা একসঙ্গে রাখুন। সহজ ও ব্যক্তিগত।',
  'One message template.': 'একটি বার্তার টেমপ্লেট।',
  'A personal update for every family.': 'প্রতিটি পরিবারের জন্য আলাদা আপডেট।',
  'Separate centers. Private records. Clear control.':
    'আলাদা সেন্টার। গোপন তথ্য। স্পষ্ট নিয়ন্ত্রণ।',
  'Password reset. Sign in with your new password.':
    'পাসওয়ার্ড বদলেছে। নতুন পাসওয়ার্ড দিয়ে সাইন ইন করুন।',
  'Lost your recovery codes? Contact the platform owner. A center admin cannot reset your personal password.':
    'রিকভারি কোড হারিয়েছেন? প্ল্যাটফর্মের মালিকের সঙ্গে যোগাযোগ করুন। সেন্টারের অ্যাডমিন ব্যক্তিগত পাসওয়ার্ড বদলাতে পারবেন না।',
  'Load more': 'আরও দেখুন',
  'Leave this page without saving your changes?': 'পরিবর্তন সংরক্ষণ না করেই পৃষ্ঠা ছাড়বেন?',
  'Leave without saving': 'সংরক্ষণ না করে বের হন',
  'Edit subject': 'বিষয় সম্পাদনা',
  Home: 'হোম',
  Students: 'শিক্ষার্থী',
  Exams: 'পরীক্ষা',
  Messages: 'বার্তা',
  More: 'আরও',
  Groups: 'ব্যাচ',
  Templates: 'টেমপ্লেট',
  'Academic setup': 'শিক্ষা সংক্রান্ত সেটআপ',
  'No subjects yet': 'এখনো কোনো বিষয় নেই',
  'Add and manage subjects for your coaching center.':
    'আপনার কোচিং সেন্টারের বিষয়গুলো যোগ ও পরিচালনা করুন।',
  'Add your first subject to start creating exams.':
    'পরীক্ষা তৈরি করতে আপনার প্রথম বিষয়টি যোগ করুন।',
  'Staff & roles': 'কর্মী ও ভূমিকা',
  Settings: 'সেটিংস',
  'Account security': 'অ্যাকাউন্ট নিরাপত্তা',
  Platform: 'প্ল্যাটফর্ম',
  'Sign out': 'সাইন আউট',
  'Sign in': 'সাইন ইন',
  'Phone number': 'ফোন নম্বর',
  Password: 'পাসওয়ার্ড',
  Name: 'নাম',
  Save: 'সংরক্ষণ',
  Cancel: 'বাতিল',
  Close: 'বন্ধ',
  Search: 'খুঁজুন',
  Next: 'পরবর্তী',
  Back: 'পেছনে',
  'Add student': 'শিক্ষার্থী যোগ করুন',
  'Create exam': 'পরীক্ষা তৈরি করুন',
  'Send results': 'ফলাফল পাঠান',
  'New message': 'নতুন বার্তা',
  'View all': 'সব দেখুন',
  Continue: 'এগিয়ে যান',
  'Loading…': 'লোড হচ্ছে…',
  'Try again': 'আবার চেষ্টা করুন',
  'No records yet': 'এখনো কোনো তথ্য নেই',
  'Create your first record to get started.': 'শুরু করতে প্রথম তথ্য যোগ করুন।',
  Overview: 'সারসংক্ষেপ',
  'Welcome back': 'স্বাগতম',
  'A little clarity. A lot less busywork.': 'কাজের জটিলতা কমুক, সময় বাঁচুক।',
  'Your coaching center, connected.': 'আপনার কোচিং সেন্টার, একসাথে।',
  'Recent messages': 'সাম্প্রতিক বার্তা',
  'SMS balance': 'এসএমএস ব্যালেন্স',
  'Refresh balance': 'ব্যালেন্স হালনাগাদ',
  'Not checked yet': 'এখনো যাচাই করা হয়নি',
  'Balance is cached, not a reservation.': 'এটি সর্বশেষ জানা ব্যালেন্স; টাকা সংরক্ষিত নয়।',
  'Add group': 'ব্যাচ যোগ করুন',
  Class: 'শ্রেণি',
  Session: 'শিক্ষাবর্ষ',
  Subject: 'বিষয়',
  Series: 'পরীক্ষার সিরিজ',
  'Identifier / roll': 'আইডি / রোল',
  'Identifier / roll (optional)': 'আইডি / রোল (ঐচ্ছিক)',
  Contacts: 'যোগাযোগ',
  Guardian: 'অভিভাবক',
  Student: 'শিক্ষার্থী',
  'Add contact': 'যোগাযোগ যোগ করুন',
  'Permission to send SMS': 'এসএমএস পাঠানোর অনুমতি',
  Archive: 'আর্কাইভ',
  Delete: 'মুছুন',
  'Send message': 'বার্তা পাঠান',
  'Phone numbers for SMS notifications and guardian updates':
    'এসএমএস বিজ্ঞপ্তি ও অভিভাবক যোগাযোগের জন্য ফোন নম্বর',
  'Remove this student from active batches and message lists. Past exam results and message history will be preserved.':
    'আর্কাইভ করলে এই শিক্ষার্থী বর্তমান ব্যাচ ও বার্তার তালিকা থেকে বাদ পড়বে। পূর্বের ফলাফল ও বার্তার ইতিহাস সংরক্ষিত থাকবে।',
  Edit: 'সম্পাদনা',
  Date: 'তারিখ',
  'Maximum marks': 'পূর্ণমান',
  'Add subject': 'বিষয় যোগ করুন',
  'Add another subject paper': 'আরেকটি বিষয় যোগ করুন',
  Subjects: 'বিষয়সমূহ',
  'Papers and score limits': 'বিষয় ও পূর্ণমান নির্ধারণ',
  'Publish Results': 'ফলাফল প্রকাশ ও পাঠান',
  'Ready to share scores with students and parents via SMS?':
    'শিক্ষার্থী ও অভিভাবকদের এসএমএস-এর মাধ্যমে নম্বর পাঠাতে প্রস্তুত?',
  'Send to': 'কাদের পাঠাবেন',
  Participants: 'অংশগ্রহণকারী',
  'Add participants': 'অংশগ্রহণকারী যোগ করুন',
  'Participating groups': 'অংশগ্রহণকারী ব্যাচ',
  'students in exam': 'জন শিক্ষার্থী',
  Remove: 'সরান',
  'Remove group': 'ব্যাচ সরান',
  'from this exam?': 'এই পরীক্ষা থেকে?',
  'Remove group from exam': 'পরীক্ষা থেকে ব্যাচটি সরান',
  'Students in this group will be removed from exam participants. Any recorded marks must be cleared first.':
    'এই ব্যাচের শিক্ষার্থীরা পরীক্ষা থেকে বাদ পড়বে। ইতিমধ্যে নম্বর দেওয়া থাকলে আগে তা মুছতে হবে।',
  'Enter marks': 'নম্বর লিখুন',
  'Save marks': 'নম্বর সংরক্ষণ',
  'Delete student': 'শিক্ষার্থী মুছুন',
  'Delete group': 'ব্যাচ মুছুন',
  'Delete subject': 'বিষয় মুছুন',
  'Delete template': 'টেমপ্লেট মুছুন',
  'Delete role': 'রোল মুছুন',
  'Delete exam': 'পরীক্ষা মুছুন',
  'All groups': 'সব ব্যাচ',
  'Filter by group': 'ব্যাচ অনুসারে বাছাই',
  'Add participating groups': 'অংশগ্রহণকারী ব্যাচ যোগ করুন',
  'No students in this group': 'এই ব্যাচে কোনো শিক্ষার্থী নেই',
  'No students have been assigned to this group yet.':
    'এখনও এই ব্যাচে কোনো শিক্ষার্থী যুক্ত করা হয়নি।',
  'No group': 'ব্যাচহীন',
  'No students from this group are participating in this exam.':
    'এই ব্যাচ থেকে কোনো শিক্ষার্থী এই পরীক্ষায় অংশগ্রহণ করছে না।',
  'You have unsaved marks. Save or discard them before switching groups.':
    'আপনার কিছু নম্বর সংরক্ষণ করা হয়নি। ব্যাচ পরিবর্তন করার আগে সংরক্ষণ করুন বা বাতিল করুন।',
  'Zero and absent are different results.': 'শূন্য ও অনুপস্থিত দুটি ভিন্ন ফলাফল।',
  Scored: 'নম্বরপ্রাপ্ত',
  Absent: 'অনুপস্থিত',
  Pending: 'বাকি',
  Exempt: 'প্রযোজ্য নয়',
  Saved: 'সংরক্ষিত',
  'Unsaved changes': 'অসংরক্ষিত পরিবর্তন',
  'Choose a subject': 'বিষয় নির্বাচন করুন',
  'Choose a group': 'ব্যাচ নির্বাচন করুন',
  'All students': 'সব শিক্ষার্থী',
  'Subject result': 'এক বিষয়ের ফলাফল',
  'Combined results': 'সমন্বিত ফলাফল',
  Announcement: 'ঘোষণা',
  'Message type': 'বার্তার ধরন',
  Recipients: 'প্রাপক',
  Both: 'উভয়',
  Message: 'বার্তা',
  'Insert variable': 'ভেরিয়েবল যোগ করুন',
  'Prepare preview': 'প্রিভিউ তৈরি করুন',
  Preview: 'প্রিভিউ',
  'Send now': 'এখনই পাঠান',
  'Schedule send': 'পরে পাঠান',
  'Confirm sending': 'পাঠানো নিশ্চিত করুন',
  'Confirm schedule': 'সময়সূচি নিশ্চিত করুন',
  Delivered: 'পৌঁছেছে',
  Accepted: 'গৃহীত',
  Failed: 'ব্যর্থ',
  'Needs checking': 'যাচাই প্রয়োজন',
  Queued: 'সারিতে',
  Scheduled: 'নির্ধারিত',
  Preparing: 'প্রস্তুতি চলছে',
  Completed: 'সম্পন্ন',
  Cancelled: 'বাতিল',
  Paused: 'স্থগিত',
  Processing: 'প্রক্রিয়াধীন',
  'Ready for review': 'পর্যালোচনার জন্য প্রস্তুত',
  'Needs review': 'পর্যালোচনা প্রয়োজন',
  'Resume pending messages': 'বাকি বার্তা চালু করুন',
  'Create template': 'টেমপ্লেট তৈরি করুন',
  'Template name': 'টেমপ্লেটের নাম',
  'Role name': 'ভূমিকার নাম',
  'Create role': 'ভূমিকা তৈরি করুন',
  'Invite staff': 'কর্মী আমন্ত্রণ',
  Invite: 'আমন্ত্রণ',
  Permissions: 'অনুমতি',
  Read: 'দেখা',
  Create: 'তৈরি',
  Update: 'সম্পাদনা',
  'API key': 'এপিআই কী',
  'Sender IDs': 'সেন্ডার আইডি',
  'Save SMS account': 'এসএমএস অ্যাকাউন্ট সংরক্ষণ',
  Timezone: 'সময় অঞ্চল',
  'Center name': 'সেন্টারের নাম',
  'Late-send window (minutes)': 'বিলম্বে পাঠানোর সময়সীমা (মিনিট)',
  'Recovery code': 'রিকভারি কোড',
  'New password': 'নতুন পাসওয়ার্ড',
  'Current password': 'বর্তমান পাসওয়ার্ড',
  'Reset password': 'পাসওয়ার্ড পুনর্নির্ধারণ',
  'Save recovery codes': 'রিকভারি কোড সংরক্ষণ করুন',
  'I saved my codes': 'আমি কোড সংরক্ষণ করেছি',
  'Forgot password?': 'পাসওয়ার্ড ভুলে গেছেন?',
  'Set up platform': 'প্ল্যাটফর্ম সেটআপ',
  'Setup key': 'সেটআপ কী',
  'Your name': 'আপনার নাম',
  'Create center': 'সেন্টার তৈরি করুন',
  'Admin name': 'অ্যাডমিনের নাম',
  'Coaching centers': 'কোচিং সেন্টার',
  'Activate account': 'অ্যাকাউন্ট চালু করুন',
  'Invitation link': 'আমন্ত্রণ লিংক',
  Copy: 'কপি',
  Active: 'সক্রিয়',
  Suspended: 'বন্ধ',
  'No matching records': 'কোনো তথ্য পাওয়া যায়নি',
  'Clear your search or try another name.': 'খোঁজা মুছে আবার চেষ্টা করুন।',
  'Live sending is disabled': 'সরাসরি এসএমএস পাঠানো বন্ধ',
  'Estimated segments': 'আনুমানিক এসএমএস অংশ',
  'Excluded students': 'বাদ পড়া শিক্ষার্থী',
  'Review messages': 'বার্তা পর্যালোচনা',
  Status: 'অবস্থা',
  'Full access': 'সম্পূর্ণ অনুমতি',
  'Save role': 'ভূমিকা সংরক্ষণ',
  Send: 'পাঠান',
  Refresh: 'হালনাগাদ',
  'Transfer ownership': 'মালিকানা হস্তান্তর',
  'Go to center': 'সেন্টারে যান',
  'Create a group first': 'আগে একটি ব্যাচ তৈরি করুন',
  'Create a subject first': 'আগে একটি বিষয় তৈরি করুন',
  'Preparing your messages…': 'আপনার বার্তা প্রস্তুত হচ্ছে…',
  'No pending work': 'কোনো কাজ বাকি নেই',
  'You are offline': 'আপনি অফলাইনে আছেন',
  'Read-only': 'শুধু দেখা যাবে',
  'Select exams': 'পরীক্ষা নির্বাচন করুন',
  'No import. No repetitive typing. Just your next step.': 'বারবার একই লেখা নয়। এগিয়ে যান সহজে।',
  Profile: 'প্রোফাইল',
  'Delivery details': 'ডেলিভারির বিবরণ',
  Add: 'যোগ করুন',
  'Save changes': 'পরিবর্তন সংরক্ষণ',
  'Back to sign in': 'সাইন ইনে ফিরে যান',
  'Sign in to accept': 'আমন্ত্রণ গ্রহণ করতে সাইন ইন করুন',
  'Regenerate recovery codes': 'নতুন রিকভারি কোড তৈরি করুন',
  View: 'দেখুন',
  'Are you sure you want to sign out?': 'আপনি কি নিশ্চিতভাবে সাইন আউট করতে চান?',
  'Switch coaching center': 'কোচিং সেন্টার পরিবর্তন',
  Switch: 'পরিবর্তন করুন',
  'Delete campaign': 'ক্যাম্পেইন মুছে ফেলুন',
  'Permanently remove this exam, all papers, participants, and recorded marks.':
    'এই পরীক্ষা, সমস্ত বিষয়/পেপার, শিক্ষার্থী এবং প্রাপ্ত নম্বর স্থায়ীভাবে মুছে ফেলুন।',
  'Permanently remove this message campaign and its recorded delivery history.':
    'এই বার্তা ক্যাম্পেইন এবং এর সমস্ত প্রেরণের তথ্য স্থায়ীভাবে মুছে ফেলুন।',
  'Are you sure you want to delete': 'আপনি কি নিশ্চিতভাবে মুছে ফেলতে চান',
  'This will permanently delete this exam, all associated subject papers, and all student results. This cannot be undone.':
    'এটি এই পরীক্ষা, সংশ্লিষ্ট সমস্ত বিষয়ের প্রশ্নপত্র এবং সমস্ত শিক্ষার্থীর ফলাফল স্থায়ীভাবে মুছে ফেলবে। এটি আর ফিরিয়ে আনা যাবে না।',
  Confirm: 'নিশ্চিত করুন',
  'Search groups…': 'গ্রুপ খুঁজুন…',
  'Choose groups…': 'গ্রুপ নির্বাচন করুন…',
  'groups selected': 'টি গ্রুপ নির্বাচিত',
  'No groups selected': 'কোনো গ্রুপ নির্বাচিত নয়',
  'Select the groups or batches this student belongs to.':
    'শিক্ষার্থীর গ্রুপ বা ব্যাচ নির্বাচন করুন।',
  'Search exams…': 'পরীক্ষা খুঁজুন…',
  'Search batches…': 'ব্যাচ খুঁজুন…',
  'Choose exams…': 'পরীক্ষা নির্বাচন করুন…',
  'Choose an exam…': 'একটি পরীক্ষা নির্বাচন করুন…',
  'exams selected': 'টি পরীক্ষা নির্বাচিত',
  'batches selected': 'টি ব্যাচ নির্বাচিত',
  'All students included (no batch filter)': 'সব শিক্ষার্থী অন্তর্ভুক্ত (কোনো ব্যাচ ফিল্টার নেই)',
  'None selected': 'কোনোটি নির্বাচিত নয়',
  selected: 'নির্বাচিত',
  'No matches found': 'কোনো মিল পাওয়া যায়নি',
  'Clear search': 'অনুসন্ধান মুছুন',
  Clear: 'মুছুন',
  Done: 'সম্পন্ন',
};
const LocaleContext = createContext<{
  locale: 'en' | 'bn';
  toggle: () => void;
  t: (key: string) => string;
}>({ locale: 'en', toggle: () => {}, t: (key) => key });
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<'en' | 'bn'>(() =>
    localStorage.getItem('locale') === 'bn' ? 'bn' : 'en',
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(
    () => ({
      locale,
      toggle: () =>
        setLocale((current) => {
          const next = current === 'en' ? 'bn' : 'en';
          localStorage.setItem('locale', next);
          document.documentElement.lang = next;
          return next;
        }),
      t: (key: string) => (locale === 'bn' ? (bn[key] ?? key) : key),
    }),
    [locale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  return useContext(LocaleContext);
}
