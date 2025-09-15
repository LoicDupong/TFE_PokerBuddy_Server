const helloWorldController =  {
    message: async(req, res) => {
        
        res.status(200).json({
            message: 'Hello World !'
        });
    }
}

export default helloWorldController;