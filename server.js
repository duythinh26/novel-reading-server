import express from "express";
import mongoose from "mongoose";
import "dotenv/config";
import bcrypt from "bcrypt";
import { nanoid } from "nanoid";
import jwt from "jsonwebtoken";
import cors from "cors";
import aws from "aws-sdk";

import User from "./Schema/User.js";
import Novel from "./Schema/Novel.js";
import Notification from "./Schema/Notification.js"
import Comment from "./Schema/Comment.js";
import Episode from "./Schema/Episode.js";
import Chapter from "./Schema/Chapter.js"

const server = express();
let PORT = 3000;

let emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,4})+$/;
let passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,20}$/; 
let cardNumberRegex = /^\d{16}$/;
let expiryDateRegex = /^(0[1-9]|1[0-2])\/\d{2}$/;
let cvvRegex = /^\d{3,4}$/;

// Enable json sharing in order to accept the json data
server.use(express.json());
server.use(cors());

// Connect Mongoose to server
mongoose.connect(process.env.DB_LOCATION, {
    autoIndex: true
});

// set up aws s3 bucket
const s3 = new aws.S3({
    region: 'ap-southeast-1',
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
})

// Generate a random upload url for front-end uploading
const generateUploadURL = async () => {
    const date = new Date();
    const imageName = `${nanoid()}-${date.getTime()}.jpeg`;

    return await s3.getSignedUrlPromise('putObject', {
        Bucket: 'novel-publishing-and-reading-website',
        Key: 'lightnovels/' + imageName,
        Expires: 3000,
        ContentType: "image/jpeg",
    })
}

const formatDatatoSend = (user) => { 
    // Make an access token to verify user login
    const access_token = jwt.sign({ id: user._id }, process.env.SECRET_ACCESS_KEY);

    return {
        access_token,
        profile_img: user.personal_info.profile_img,
        username: user.personal_info.username
    }
}

const verifyJWT = (req, res, next) => {
    const authHeaders = req.headers['authorization'];

    const token = authHeaders && authHeaders.split(" ")[1];
    if (token == null) {
        return res.status(401).json({ error: "No access token" });
    }

    jwt.verify(token, process.env.SECRET_ACCESS_KEY, (err, user) =>{
        if (err) {
            return res.status(403).json({ error: "Access token không khả dụng" });
        }

        req.user = user.id;
        next();
    });
}

const deleteComments = async (_id) => {
    try {
        const comment = await Comment.findOne({ _id });
        if (comment) {
            if (comment.parent) { // Checking parent key of the comment
                await Comment.findOneAndUpdate({ _id: comment.parent }, { $pull: { children: _id } });
                console.log("Comment deleted from parent");
            }

            await Notification.findOneAndDelete({ comment: _id });
            console.log("Notification deleted");

            await Notification.findOneAndDelete({ reply: _id });
            console.log("Reply notification deleted");

            await Novel.findOneAndUpdate({ _id: comment.novel_id }, { $pull: { comments: _id }, $inc: { "activity.total_comments": -1, "activity.total_parent_comments": comment.parent ? 0 : -1 } });

            if (comment.children.length) {
                for (let replyId of comment.children) {
                    await deleteComments(replyId);
                }
            }

            await Comment.findOneAndDelete({ _id });
            console.log("Comment deleted from database");
        }
    } catch (err) {
        console.log(err.message)
    }
}

// Upload images url route
server.get("/get-upload-url", (req, res) => {
    generateUploadURL().then(url => res.status(200).json({ uploadURL: url }))
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })
})

server.post("/signup", async (req, res) => {
    let { username, email, password } = req.body;

    // Validate data from front end 
    if (username.length < 3) {
        return res.status(403).json({ "error": "Tên tài khoản phải ít nhất 3 ký tự" }); //status using to throw a status code
    } 

    // Check user input email or not
    if (!email.length) {
        return res.status(403).json({ "error": "Bạn chưa nhập email" });
    }

    if (!password.length) {
        return res.status(403).json({ "error": "Bạn chưa nhập mật khẩu" });
    }

    if (!emailRegex.test(email)) {
        return res.status(403).json({ "error": "Email không khả dụng" });
    }

    if (!passwordRegex.test(password)) {
        return res.status(403).json({ "error": "Mật khẩu từ 8 tới 20 ký tự và có ít nhất một chữ in hoa và một chữ số" });
    }

    bcrypt.hash(password, 10, (err, hashed_password) => {
        
        let user = new User({
            personal_info: {
                username, email, password: hashed_password
            }
        })

        user.save().then((u) => {
            return res.status(200).json(formatDatatoSend(u))
        })
        .catch(err => {
            // When MongoDB catch a duplication error, it throw out error code 11000
            if (err.code === 11000) {
                const duplicateKey = Object.keys(err.keyPattern)[0];

                if (duplicateKey === "personal_info.email") {
                    return res.status(403).json({ error: "Email đã tồn tại" });
                } 
                else if (duplicateKey === "personal_info.username") {
                    return res.status(403).json({ error: "Tên đăng nhập đã tồn tại" });
                }
            }

            return res.status(500).json({ "error": err.message })
        }) 
    })
})

// Change this to make a login can use email or username
server.post("/signin", (req, res) => {
    let { email, password } = req.body;

    // Try to find email that user input is exist or not
    User.findOne({ "personal_info.email": email}).then((user) => {
        // If not, return error email not found
        if (!user) {
            return res.status(403).json({ "error": "Không tìm thấy email" });
        }
        
        bcrypt.compare(password, user.personal_info.password, (err, result) => {
            if (err) {
                return res.status(403).json({ "error": "Lỗi xuất hiện khi đăng nhập, xin hãy thử lại" });
            }

            // If password is incorrect
            if (!result) {
                return res.status(403).json({ "error": "Mật khẩu sai" });
            } else {
                return res.status(200).json(formatDatatoSend(user));
            }
        })
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ "error": err.message });
    })
})

server.post("/change-password", verifyJWT, (req, res) => {
    let { currentPassword, newPassword, confirmationPassword } = req.body;

    if (!passwordRegex.test(currentPassword) || !passwordRegex.test(newPassword)) {
        return res.status(403).json({ "error": "Mật khẩu từ 8 tới 20 ký tự và có ít nhất một chữ in hoa và một chữ số" })
    }

    if (newPassword !== confirmationPassword) {
        return res.status(403).json({ error: "Mật khẩu không trùng khớp" });
    }

    User.findOne({ _id: req.user })
    .then((user) => {
        if (user.google_auth) {
            return res.status(403).json({ error: "Bạn không thể đổi mật khẩu" })
        }

        bcrypt.compare(currentPassword, user.personal_info.password, (err, result) => {
            if (err) {
                return res.status(500).json({ error: "Lỗi xảy ra khi thay đổi mật khẩu. Xin vui lòng thử lại!" })
            }

            if (!result) {
                return res.status(403).json({ error: "Mật khẩu hiện tại không chính xác" })
            }

            if (currentPassword === newPassword) {
                return res.status(403).json({ error: "Mật khẩu không trùng khớp" });
            }

            bcrypt.hash(newPassword, 10, (err, hashed_password) => {
                User.findOneAndUpdate({ _id: req.user }, { "personal_info.password": hashed_password })
                .then((user) => {
                    return res.status(200).json({ status: "Đã đổi mật khẩu" })
                }) 
                .catch(err => {
                    return res.status(500).json({ error: "Lỗi xảy ra khi cố gắng lưu mật khẩu mới. Xin vui lòng thử lại!" })
                })
            })
        })
    })
    .catch(err => {
        console.log(err);
        return res.status(500).json({ error: "Không tìm thấy người dùng" })
    })
})

server.get("/trending", (req, res) => {
    Novel.find({ draft: false })
    .populate("publisher", "personal_info.username personal_info.profile_img -_id") // populate adds username and profile_img to publisher variable
    .sort({ "activity.total_reads": -1, "activity.total_likes": -1, "updatedAt": -1 }) // -1 gives the lastest updatedAt variable in database
    .select("novel_id novel_title novel_banner author artist categories description activity publishedAt updatedAt -_id") // select gives the tag need for frontend
    .limit(4) // limit the number of novel in one page
    .then(novels => {
        return res.status(200).json({ novels })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

// Can be changed in the future
server.get("/latest-original", (req, res) => {
    Novel.find({ draft: false, type_of_novel: "Truyện sáng tác" })
    .populate("publisher", "personal_info.username personal_info.profile_img -_id") // populate adds username and profile_img to publisher variable
    .sort({ "updatedAt": -1 }) // -1 gives the lastest updatedAt variable in database
    .select("novel_id novel_title novel_banner author artist categories description activity publishedAt updatedAt -_id") // select gives the tag need for frontend
    .limit(5) // limit the number of novel in one page
    .then(novels => {
        return res.status(200).json({ novels })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

// Can be changed in the future
server.get("/latest-chapter", (req, res) => {
    Novel.find({ draft: false, type_of_novel: "Truyện dịch" })
    .populate("publisher", "personal_info.username personal_info.profile_img -_id") // populate adds username and profile_img to publisher variable
    .sort({ "updatedAt": -1 }) // -1 gives the lastest updatedAt variable in database
    .select("novel_id novel_title novel_banner author artist categories description activity publishedAt updatedAt -_id") // select gives the tag need for frontend
    .limit(11) // limit the number of novel in one page
    .then(novels => {
        return res.status(200).json({ novels })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.get("/latest-publish", (req, res) => {
    Novel.find({ draft: false })
    .populate("publisher", "personal_info.username personal_info.profile_img -_id") // populate adds username and profile_img to publisher variable
    .sort({ "publishedAt": -1 }) // -1 gives the lastest updatedAt variable in database
    .select("novel_id novel_title novel_banner author artist categories description activity publishedAt updatedAt -_id") // select gives the tag need for frontend
    .limit(6) // limit the number of novel in one page
    .then(novels => {
        return res.status(200).json({ novels })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.post('/search-novels', (req, res) => {
    let { query, page, publisher } = req.body;

    let maxLimit = 6;

    let regexQuery = { draft: false };

    // Search by novel title or other name
    if (query) {
        regexQuery.$or = [
            { novel_title: { $regex: query, $options: 'i' } },
            { other_name: { $regex: query, $options: 'i' } }
        ];
    } else if(publisher) {
        regexQuery = { publisher, draft: false }
    } else {
        return res.status(200).json({ novels: [] })
    }

    Novel.find(regexQuery)
    .populate("publisher", "personal_info.username personal_info.profile_img -_id")
    .sort({ "publishedAt": -1 })
    .select("novel_id novel_title novel_banner other_name author artist type_of_novel categories description activity status publishedAt updatedAt -_id")
    .skip((page - 1) * maxLimit)
    .limit(maxLimit)
    .then(novels => {
        return res.status(200).json({ novels })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.post('/all-novels', (req, res) => {
    // countDocuments let we run a count query in order to count the number of documents
    Novel.countDocuments({ draft: false })
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })
})

server.post('/search-novels-count', (req, res) => {
    let { query, publisher } = req.body;

    let regexQuery = { draft: false };

    // Search by novel title or other name
    if (query) {
        regexQuery.$or = [
            { novel_title: { $regex: query, $options: 'i' } },
            { other_name: { $regex: query, $options: 'i' } }
        ];
    } else if(publisher) {
        regexQuery = { publisher, draft: false }
    }

    Novel.countDocuments(query)
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })
})

server.post('/create-series', verifyJWT, (req, res) => {
    let publisherId = req.user;

    let {
        novel_title, 
        other_name,
        sensitive_content,
        novel_banner,
        author,
        artist,
        type_of_novel,
        categories,
        description,
        note,
        status,
        episode,
        draft
    } = req.body;

    if (!novel_title.length) {
        return res.status(403).json({ error: "Truyện chưa có novel_title" });
    }
    
    if (!author.length) {
        return res.status(403).json({ error: "Truyện chưa có tác giả" });
    }

    if (!categories.length) {
        return res.status(403).json({ error: "Truyện chưa có thể loại" });
    }
    
    if (!description.length) {
        return res.status(403).json({ error: "Truyện chưa có tóm tắt" });
    }

    let novel_id = novel_title.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, "-").trim() + nanoid();

    const r16 = !!sensitive_content;

    let novel = new Novel({
        novel_id,
        novel_title, 
        other_name,
        sensitive_content: Boolean(sensitive_content),
        novel_banner,
        author,
        artist,
        type_of_novel,
        categories,
        description,
        note,
        status,
        // episode,
        publisher: publisherId,
        draft: Boolean(draft)
    })

    novel.save().then(novel => {
        let incrementValue = draft ? 0 : 1;

        User.findOneAndUpdate({ _id: publisherId }, { $inc: { "account_info.total_posts": incrementValue }, $push: { "novels": novel._id } })
        .then(user => {
            return res.status(200).json({ id: novel.novel_id });
        })
        .catch(err => {
            return res.status(500).json({ error: "Không thể cập nhật tổng số truyện đã đăng" });
        })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message });
    })
})

server.post('/users', (req, res) => {
    let { username } = req.body;

    User.findOne({ "personal_info.username": username })
    .select("-google_auth -personal_info.password -updatedAt -novels")
    .then(user => {
        return res.status(200).json({ user })
    })
    .catch(err => {
        console.log(err.message)
        return res.status(500).json({ error: err.message })
    })
})

server.post("/update-profile-img", verifyJWT, (req, res) => {
    let { url } = req.body;

    User.findOneAndUpdate({ _id: req.user }, { "personal_info.profile_img": url })
    .then(() => {
        return res.status(200).json({ profile_img: url })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.post('/get-novels', (req, res) => {
    // Retrieve id from req
    let { novel_id } = req.body;

    let incrementVal = 1;

    // Increase novel total reads by 1
    Novel.findOneAndUpdate({ novel_id }, { $inc: { "activity.total_reads": incrementVal }})
    .populate("publisher", "personal_info.username personal_info.profile_img")
    .select("-draft")
    .then(novel => {
        // Increase user total reads by increase by 1
        User.findOneAndUpdate({ "personal_info.username": novel.publisher.personal_info.username }, 
        {
            $inc: { "account_info.total_reads": incrementVal }
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })

        return res.status(200).json({ novel });
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.post('/like-novel', verifyJWT, (req, res) => {
    let user_id = req.user;

    let { _id, isLikedByUser } = req.body;

    let incrementVal = !isLikedByUser ? 1 : -1;

    Novel.findOneAndUpdate({ _id }, { $inc: { "activity.total_likes": incrementVal }})
    .then(novel => {
        if (!isLikedByUser){
            let like = new Notification({
                type: "like",
                novel: _id,
                notification_for: novel.publisher,
                user: user_id
            })

            like.save().then(notification => {
                return res.status(200).json({ liked_by_user: true })
            })
        } else { // If user dislike novel
            Notification.findOneAndDelete({ user: user_id, novel: _id, type: "like" })
            .then(data => {
                return res.status(200).json({ liked_by_user: false })
            })
        }
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.post('/isliked-by-user', verifyJWT, (req, res) => {
    let user_id = req.user;

    let { _id } = req.body;

    Notification.exists({ user: user_id, type: "like", novel: _id })
    .then(result => {
        return res.status(200).json({ result })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.post("/add-comment", verifyJWT, (req, res) => {
    let user_id = req.user;

    let { _id, comment, novel_publisher, replying_to } = req.body;

    if (!comment.length) {
        return res.status(403).json({ err: "Bạn chưa viết gì để bình luận"})
    }

    // Create a comment docs
    let commentObject = {
        novel_id: _id,
        novel_publisher,
        comment,
        commented_by: user_id,
        isReply: !!replying_to,
    }

    if (replying_to) {
        commentObject.parent = replying_to;
    }

    new Comment(commentObject).save().then(async commentFile => {
        // Update novel total comments
        let { comment, commentedAt, children } = commentFile;

        Novel.findOneAndUpdate({ _id }, { $push: { "comments": commentFile._id }, $inc: { "activity.total_comments": 1, "activity.total_parent_comments": replying_to ? 0 : 1 } })
        .then(novel => {
            User.findOneAndUpdate({ user_id }, { $inc: {"account_info.total_comments": 1 }})
            console.log("New comment created");
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })

        let notificationObject = {
            type: replying_to ? "reply" :"comment",
            novel: _id,
            notification_for: novel_publisher,
            user: user_id,
            comment: commentFile._id
        }

        if (replying_to) {
            notificationObject.replied_on_comment = replying_to;

            await Comment.findOneAndUpdate({ _id: replying_to }, { $push: { children: commentFile._id }})
            .then(replyToDoc => {
                notificationObject.notification_for = replyToDoc.commented_by
            })
        }
        
        new Notification(notificationObject).save().then(notification => {
            console.log("New notification created");
        })

        return res.status(200).json({
            comment, commentedAt, _id: commentFile._id, user_id, children
        })
    })
})

server.post("/get-novel-comments", (req, res) => {
    let { novel_id, skip } = req.body;

    let maxLimit = 5;

    Comment.find({ novel_id, isReply: false })
    .populate("commented_by", "personal_info.username personal_info.profile_img")
    .skip(skip)
    .limit(maxLimit)
    .sort({
        'commentedAt': -1
    })
    .then(comment => {
        return res.status(200).json(comment)
    })
    .catch((err) => {
        console.log(err.message)
        return res.status(500).json({ error: err.message })
    })
})

server.post("/get-replies", (req, res) => {
    let { _id, skip } = req.body;

    let maxLimit = 5;

    Comment.findOne({ _id, })
    .populate({
        path: "children", // path is the key want to populate
        options: {
            limit: maxLimit,
            skip: skip,
            sort: { 'commentedAt': -1 }
        }, // options is what we want to do
        populate: {
            path: 'commented_by',
            select: "personal_info.profile_img personal_info.username"
        },
        select: "-novel_id -updatedAt"
    })
    .select("children")
    .then(doc => {
        return res.status(200).json({ replies: doc.children })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })

})

server.post("/delete-comment", verifyJWT, async (req, res) => {
    let user_id = req.user;

    let { _id } = req.body;

    try {
        const comment = await Comment.findOne({ _id })
        if (comment) {
            if (user_id == comment.commented_by || user_id == comment.novel_publisher) {
                await deleteComments(_id);
                return res.status(200).json({ status: "Done" });
            } else {
                return res.status(403).json({ error: "You cannot delete this comment" });
            }
        } else {
            return res.status(404).json({ error: "Comment not found" });
        }
    } catch (err) {
        console.log(err.message);
        return res.status(500).json({ error: "Internal server error" });
    }
})

server.get("/new-notification", verifyJWT, (req, res) => {
    let user_id = req.user;

    Notification.exists({ notification_for: user_id, seen: false, user: { $ne: user_id }})
    .then(result => {
        if (result) {
            return res.status(200).json({ new_notification_available: true })
        } else {
            return res.status(200).json({ new_notification_available: false })
        }
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })
})

server.post("/novel-published", verifyJWT, (req, res) => {
    let user_id = req.user;

    let { draft, query, deletedDocCount } = req.body;

    if (deletedDocCount) {
        skipDocs -= deletedDocCount;
    }

    let searchConditions = { publisher: user_id, draft };

    if (query) {
        searchConditions.novel_title = new RegExp(query, 'i');
    }

    Novel.find(searchConditions)
    .sort({ publishedAt: -1 })
    .select("-_id")
    .then(novels => {
        return res.status(200).json({ novels });
    })
    .catch(err => {
        return res.status(500).json({ error: err.message });
    })
})

server.post("/novel-published-count", (req, res) => {
    let user_id = req.user;

    let { draft, query } = req.body;

    let searchConditions = { publisher: user_id, draft };

    if (query) {
        searchConditions.novel_title = new RegExp(query, 'i');
    }

    Novel.countDocuments(searchConditions)
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({ error: err.message })
    })
})

server.post("/delete-novel", verifyJWT, (req, res) => {
    let user_id = req.user;
    let { novel_id } = req.body;

    Novel.findOneAndDelete({ novel_id })
    .then(novel => {
        Notification.deleteMany({ novel: novel._id })
        .then(data => {
            console.log("Đã xóa tắt cả thông báo");
        })
        .catch(err => {
            console.log("Có lỗi khi xóa thông báo");
        })

        Comment.deleteMany({ novel: novel._id })
        .then(data => {
            console.log("Đã xóa tắt cả bình luận");
        })
        .catch(err => {
            console.log("Có lỗi khi xóa bình luận");
        })

        User.findOneAndUpdate({ _id: user_id }, { $pull: { novel: novel_id }, $inc: { "account_info.total_posts": -1} })
        .then(user => {
            console.log("Đã xóa truyện");
        })
        .catch(err => {
            console.log("Có lỗi khi xóa truyện");
        })

        return res.status(200).json({ status: "Đã hoàn thành" });
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.put("/update-novel", verifyJWT, async (req, res) => {
    let { novel_id, novel_title, novel_banner, other_name, sensitive_content, author, artist, type_of_novel, categories, description, note, status } = req.body;

    try {
        if (!req.body) {
            return res.status(400).send({ message: "Send all required fields" })
        }

        // Check existing novel
        const existingNovel = await Novel.findOne({ novel_id });

        if (!existingNovel) {
            return res.status(404).send({ message: "Không tìm thấy novel" });
        }

        await Novel.findOneAndUpdate({ novel_id }, { "novel_title": novel_title, "novel_banner": novel_banner, "other_name": other_name, "sensitive_content": sensitive_content, "novel_banner": novel_banner, "author": author, "artist": artist, "type_of_novel": type_of_novel, "categories": categories, "description": description, "note": note, "status": status })
        .then((novel) => {
            return res.status(200).json({ message: "Đã cập nhật truyện" })
        })
        .catch(err => {
            return res.status(404).json({ message: err.message })
        })
    } catch (error) {
        console.log(error.message);
        res.status(500).send({ message: error.message })
    }
})

server.post('/create-episode', verifyJWT, async (req, res) => {
    let publisherId = req.user;

    let {
        episode_title, 
        episode_banner,
        description,
        price,
        novel_id
    } = req.body;

    if (!episode_title.length) {
        return res.status(403).json({ error: "Episode chưa có tiêu đề" });
    }
    
    if (!description.length) {
        return res.status(403).json({ error: "Episode chưa có tóm tắt" });
    }

    if (price == null) {
        return res.status(403).json({ error: "Episode chưa có giá" });
    }
    
    try {
        let novel = await Novel.findOne({ novel_id });

        if (!novel) {
            return res.status(404).json({ error: "Novel không tồn tại" });
        }

        let episode_id = nanoid();
 
        let episode = new Episode({
            episode_id,
            episode_title,
            episode_banner,
            description,
            price,
            publisher: publisherId,
            belonged_to: novel._id,
        });

        await episode.save();

        novel.episode.push(episode._id);
        await novel.save();

        return res.status(200).json({ id: episode.episode_id });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
})

server.post("/get-episodes", (req, res) => {
    // Retrieve id from req
    let { episode_id } = req.body;

    Episode.findByIdAndUpdate(episode_id, { $inc: { "activity.total_reads": 1 }})
    .populate("publisher", "personal_info.username personal_info.profile_img")
    .populate("belonged_to")
    .then(episode => {
        if (!episode) {
            return res.status(404).json({ error: 'Episode not found' });
        }

        User.findOneAndUpdate({ "personal_info.username": episode.publisher.personal_info.username }, 
        {
            $inc: { "account_info.total_reads": 1 }
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })

        return res.status(200).json({ episode });
    })
    .catch(err => {
        return res.status(500).json({ error: err.message });
    });
})

server.post("/get-episode-by-publisher", verifyJWT, async (req, res) => {
    let { episode_id } = req.body;

    try {
        // Using populate to get data of novel from episode
        const episode = await Episode.findById(episode_id).populate('belonged_to');

        if (!episode) {
            return res.status(404).send({ message: "Episode not found" });
        }

        res.status(200).send({ episode });
    } catch (error) {
        console.log(error.message);
        res.status(500).send({ message: error.message });
    }
});

server.post('/purchase-coins', verifyJWT, async (req, res) => {
    const { coin_ammount, card_number, expiry_date, cvv } = req.body;

    if (!coin_ammount || coin_ammount <= 0) {
        return res.status(400).json({ error: 'Số lượng xu không hợp lệ' });
    }
    if (!card_number || !cardNumberRegex.test(card_number)) {
        return res.status(400).json({ error: 'Số thẻ tín dụng không hợp lệ' });
    }
    if (!expiry_date || !expiryDateRegex.test(expiry_date)) {
        return res.status(400).json({ error: 'Ngày hết hạn thẻ không hợp lệ' });
    }
    if (!cvv || !cvvRegex.test(cvv)) {
        return res.status(400).json({ error: 'Mã CVV không hợp lệ' });
    }

    try {
        const user = await User.findById(req.user);

        if (!user) {
            return res.status(404).json({ error: 'Người dùng không tồn tại' });
        }

        user.account_info.coin += Number(coin_ammount);
        await user.save();

        res.status(200).json({ message: 'Mua xu thành công', totalCoins: user.account_info.coin });
    } catch (err) {
        console.error('Lỗi khi mua xu:', err);
        res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
    }
});

server.post("/purchase-episode", verifyJWT, async (req, res) => {
    const user_id = req.user;

    const { _id } = req.body;

    try {
        const episode = await Episode.findOne({ _id });
        const user = await User.findById(user_id);

        if (!episode) {
            return res.status(404).json({ error: "Episode không tồn tại" });
        }

        // Kiểm tra nếu user đã sở hữu tập này
        if (user.account_info.ownedEpisode.includes(episode._id)) {
            return res.status(400).json({ success: false, message: "Bạn đã sở hữu tập này rồi." });
        }

        if (user.account_info.coin >= episode.price) {
            user.account_info.coin -= episode.price;
            user.account_info.ownedEpisode.push(episode._id);

            await user.save();

            return res.json({ success: true, message: "Thanh toán thành công!" });
        } else {
            return res.json({ success: false, message: "Không đủ xu. Vui lòng nạp thêm xu." });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
})

server.post("/check-owned-episode", verifyJWT, async (req, res) => {
    const user_id = req.user;
    const { episode_id } = req.body;

    try {
        const user = await User.findById(user_id);

        if (user.account_info.ownedEpisode.includes(episode_id)) {
            return res.json({ owned: true });
        } else {
            return res.json({ owned: false });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
})

server.post("/get-episodes-in-novel", verifyJWT, async (req, res) => {
    const { novel_id } = req.body;

    try {
        const novel = await Novel.findOne({ novel_id }).populate('episode');
        
        if (!novel) {
            return res.status(404).json({ error: 'Novel not found' });
        }

        return res.status(200).json({ episodes: novel.episode });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

server.post("/delete-episode", verifyJWT, async (req, res) => {
    let user_id = req.user;
    let { episode_id } = req.body;

    Episode.findOneAndDelete({ episode_id })
    .then(episode => {
        Notification.deleteMany({ episode: episode._id })
        .then(() => {
            console.log("Đã xóa tất cả thông báo liên quan đến episode");
        })
        .catch(err => {
            console.log("Có lỗi khi xóa thông báo liên quan đến episode", err);
        });

        Comment.deleteMany({ episode: episode._id })
        .then(() => {
            console.log("Đã xóa tất cả bình luận liên quan đến episode");
        })
        .catch(err => {
            console.log("Có lỗi khi xóa bình luận liên quan đến episode", err);
        });

        Novel.findOneAndUpdate({ _id: episode.belonged_to }, { $pull: { episode: episode._id } })
        .then(() => {
            console.log("Đã cập nhật novel liên quan");
        })
        .catch(err => {
            console.log("Có lỗi khi cập nhật novel liên quan", err);
        });

        return res.status(200).json({ status: "Đã hoàn thành" });
    })
    .catch(err => {
        return res.status(500).json({ error: err.message });
    });
})

server.put("/update-episode", verifyJWT, async (req, res) => {
    let { _id, episode_title, episode_banner, description, price } = req.body;

    try {
        if (!req.body) {
            return res.status(400).send({ message: "Send all required fields" });
        }

        // Check existing episode
        const existingEpisode = await Episode.findById({ _id });

        if (!existingEpisode) {
            return res.status(404).send({ message: "Không tìm thấy episode" });
        }

        await Episode.findByIdAndUpdate(
            _id,
            {
                "episode_title": episode_title,
                "episode_banner": episode_banner,
                "description": description,
                "price": price
            }, { new: true }
        )
        .then((episode) => {
            return res.status(200).json({ message: "Đã cập nhật tập truyện" });
        })
        .catch(err => {
            return res.status(404).json({ message: err.message });
        });
    } catch (error) {
        console.log(error.message);
        res.status(500).send({ message: error.message });
    }
})

server.post("/create-chapter", verifyJWT, async (req, res) => {
    let publisherId = req.user;

    let {
        chapter_title,
        chapter_banner,
        content,
        episode_id
    } = req.body;

    if (!chapter_title.length) {
        return res.status(403).json({ error: "Chapter chưa có tiêu đề" });
    }

    if (!content.length) {
        return res.status(403).json({ error: "Chapter chưa có nội dung" });
    }

    try {
        let episode = await Episode.findOne({ _id: episode_id });

        if (!episode) {
            return res.status(404).json({ error: "Episode không tồn tại" });
        }

        let chapter_id = nanoid();

        let chapter = new Chapter({
            chapter_id,
            chapter_title,
            chapter_banner,
            content,
            publisher: publisherId,
            belonged_to: episode._id,
        });

        await chapter.save();

        episode.chapter.push(chapter._id);
        await episode.save();

        return res.status(200).json({ id: chapter.chapter_id });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
})

server.post("/get-chapter", async (req, res) => {
    const { chapter_id } = req.body;

    try {
        const chapter = await Chapter.findById(chapter_id)
            .populate("publisher", "personal_info.username personal_info.profile_img")
            .populate("comments");

        if (!chapter) {
            return res.status(404).json({ error: 'Chapter not found' });
        }

        // Tăng số lượt đọc cho chapter và cập nhật thông tin user
        await Chapter.findByIdAndUpdate(chapter_id, { $inc: { "activity.total_reads": 1 } });

        await User.findOneAndUpdate({ _id: chapter.publisher }, 
        {
            $inc: { "account_info.total_reads": 1 }
        });

        return res.status(200).json({ chapter });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

server.post("/get-chapter-episode-novel", async (req, res) => {
    const { chapter_id } = req.body;

    try {
        // Find the chapter
        const chapter = await Chapter.findById(chapter_id)
            .populate("publisher", "personal_info.username personal_info.profile_img")
            .populate("comments");

        if (!chapter) {
            return res.status(404).json({ error: 'Chapter not found' });
        }

        // Increase chapter's total reads
        await Chapter.findByIdAndUpdate(chapter_id, { $inc: { "activity.total_reads": 1 } });

        // Update user reads count
        await User.findOneAndUpdate({ _id: chapter.publisher }, {
            $inc: { "account_info.total_reads": 1 }
        });

        // Find the episode
        const episode = await Episode.findById(chapter.belonged_to)
            .populate("publisher", "personal_info.username personal_info.profile_img")
            .populate("belonged_to"); // Populate the novel reference

        if (!episode) {
            return res.status(404).json({ error: 'Episode not found' });
        }

        // Find the novel
        const novel = await Novel.findById(episode.belonged_to) // Use the novel reference from episode
            .populate("publisher", "personal_info.username personal_info.profile_img");

        if (!novel) {
            return res.status(404).json({ error: 'Novel not found' });
        }

        return res.status(200).json({ chapter, episode, novel });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

server.get("/get-user-data", verifyJWT, async (req, res) => {
    try {
        const user = await User.findById(req.user);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.status(200).json({ user });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

server.get('/purchased-episodes', verifyJWT, async (req, res) => {
    try {
        // Find the user by ID, which is set by the verifyJWT middleware
        const userId = req.user;
    
        // Fetch the user and populate the owned episodes
        const user = await User.findById(userId).populate({
            path: 'account_info.ownedEpisode',
            model: 'episodes',
            populate: {
                path: 'belonged_to',
                model: 'novels',
                select: 'novel_id novel_title',
            },
        });
    
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
    
        // Extract the detailed episodes
        const purchasedEpisodes = user.account_info.ownedEpisode.map((episode) => ({
            _id: episode._id,
            episode_title: episode.episode_title,
            episode_banner: episode.episode_banner,
            description: episode.description,
            price: episode.price,
            belonged_to: {
                novel_id: episode.belonged_to.novel_id,
                novel_title: episode.belonged_to.novel_title,
            },
        }));
    
        res.status(200).json({ purchasedEpisodes });
    } catch (error) {
        console.error('Error fetching purchased episodes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

server.listen(PORT, () => {
    console.log("listening on port " + PORT);
})